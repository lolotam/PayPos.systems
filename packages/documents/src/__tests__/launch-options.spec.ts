import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { expect, it, vi } from 'vitest';

import {
  DEFAULT_CHROMIUM_LAUNCH_TIMEOUT_MS,
  chromiumLaunchOptions,
  getLaunchCleanup,
  playwrightFactory,
} from '../playwright/factory.ts';
import { captureOwnedDescendants, createMarkerProcess, getLaunchCleanupRetry, isPidAlive, killProcessTree, LAUNCH_MARKER_ENV } from '../playwright/process-tree.ts';

it('leaves process signals to the worker', () => {
  expect(chromiumLaunchOptions.handleSIGINT).toBe(false);
  expect(chromiumLaunchOptions.handleSIGTERM).toBe(false);
  expect(chromiumLaunchOptions.handleSIGHUP).toBe(false);
  expect(chromiumLaunchOptions.chromiumSandbox).toBe(false);
  expect(chromiumLaunchOptions.args).toEqual(['--disable-dev-shm-usage', '--disable-gpu']);
});

it('gives Chromium an explicit launch timeout below the outer launch bound', () => {
  expect(DEFAULT_CHROMIUM_LAUNCH_TIMEOUT_MS).toBe(35_000);
  expect(DEFAULT_CHROMIUM_LAUNCH_TIMEOUT_MS).toBeLessThan(40_000);
  expect(chromiumLaunchOptions.timeout).toBe(DEFAULT_CHROMIUM_LAUNCH_TIMEOUT_MS);
});

it('forwards an explicit timeout argument in playwrightFactory(timeoutMs)', async () => {
  let killedAfterClose = false;
  const childProc = { exitCode: null as number | null, kill: () => { killedAfterClose = true; childProc.exitCode = 0; return true; } };
  const proc = { pid: 99_999, exitCode: null as number | null, children: [childProc], kill: () => true };
  const osKillSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
    throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
  });
  const spy = vi.spyOn(chromium, 'launch').mockResolvedValue({
    newContext: async () =>
      ({
        route: async () => undefined,
        newPage: async () => ({}) as never,
        close: async () => undefined,
      }) as never,
    close: async () => { proc.exitCode = 0; },
    on: () => undefined,
    process: () => proc,
  } as never);
  try {
    const browser = await playwrightFactory(12_345).launch();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ timeout: 12_345 }));
    await expect(browser.close()).resolves.toBeUndefined();
    expect(killedAfterClose).toBe(true);
    expect(osKillSpy).not.toHaveBeenCalledWith(expect.anything(), 'SIGKILL');
  } finally {
    spy.mockRestore();
    osKillSpy.mockRestore();
  }
});

it('keeps missing-PID cleanup single-flight while pending and allows sequential retry after rejection', async () => {
  const launchMissing = async (close: () => Promise<void>): Promise<unknown> => {
    const spy = vi.spyOn(chromium, 'launch').mockResolvedValue({ newContext: async () => ({}) as never, close, on: () => undefined, process: () => null } as never);
    try { await playwrightFactory(50).launch(); return undefined; } catch (err) { return err; } finally { spy.mockRestore(); }
  };

  let closed = false;
  const okErr = await launchMissing(async () => { closed = true; });
  expect((okErr as Error).message).toBe('CHROMIUM_PROCESS_UNAVAILABLE');
  expect(closed).toBe(true);
  await expect(getLaunchCleanup(okErr)).resolves.toBeUndefined();

  let closeTries = 0;
  const rejErr = await launchMissing(() => (++closeTries === 1 ? Promise.reject(new Error('CLOSE_FAIL')) : Promise.resolve()));
  await expect(getLaunchCleanup(rejErr)).rejects.toThrow('CLOSE_FAIL');
  await expect(Promise.resolve(getLaunchCleanupRetry(rejErr)?.())).resolves.toBeUndefined();
  expect(closeTries).toBe(2);

  let hungTries = 0;
  let releaseClose!: () => void;
  let closeHungDone = false;
  let retryDone = false;
  const hungErr = await launchMissing(() => { hungTries += 1; return new Promise<void>((r) => { releaseClose = r; }); });
  void getLaunchCleanup(hungErr)?.then(() => { closeHungDone = true; });
  const concurrentRetry = Promise.resolve(getLaunchCleanupRetry(hungErr)?.()).then(() => { retryDone = true; });
  await new Promise((r) => setTimeout(r, 20));
  expect([closeHungDone, retryDone, hungTries]).toEqual([false, false, 1]);
  releaseClose();
  await Promise.all([expect(getLaunchCleanup(hungErr)).resolves.toBeUndefined(), concurrentRetry]);
  expect([closeHungDone, retryDone, hungTries]).toEqual([true, true, 1]);

  let lateProc: { pid: number; kill: () => boolean; exitCode: number | null } | null = null;
  let lateKilled = false;
  let lateCloseTries = 0;
  const lateSpy = vi.spyOn(chromium, 'launch').mockResolvedValue({ newContext: async () => ({}) as never, close: () => { lateCloseTries += 1; return new Promise<void>(() => undefined); }, on: () => undefined, process: () => lateProc } as never);
  let lateErr: unknown;
  try { await playwrightFactory(50).launch(); } catch (err) { lateErr = err; } finally { lateSpy.mockRestore(); }
  lateProc = { pid: 2_147_483_000, exitCode: null, kill: () => { lateKilled = true; if (lateProc !== null) lateProc.exitCode = 0; return true; } };
  await expect(Promise.resolve(getLaunchCleanupRetry(lateErr)?.())).resolves.toBeUndefined();
  expect([lateKilled, lateCloseTries]).toEqual([true, 1]);
});

function writeLinuxStat(procDir: string, pid: number, state: string, ppid: number, pgrp: number, starttime: number): void {
  const fields = Array<string>(20).fill('0');
  [fields[0], fields[1], fields[2], fields[19]] = [state, String(ppid), String(pgrp), String(starttime)];
  writeFileSync(join(procDir, String(pid), 'stat'), `${pid} (p) ${fields.join(' ')}\n`);
}

it('holds root and verified ancestors when root or grandchild fingerprint is transiently unreadable', async () => {
  const procDir = mkdtempSync(join(tmpdir(), 'pospay-proc-'));
  const spawnSleeper = () => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], { detached: true, stdio: 'ignore' });
  const [sRoot, sChild, sGrand] = [spawnSleeper(), spawnSleeper(), spawnSleeper()];
  const [rootPid, childPid, grandPid] = [sRoot.pid ?? 0, sChild.pid ?? 0, sGrand.pid ?? 0];
  expect(Math.min(rootPid, childPid, grandPid)).toBeGreaterThan(0);
  try {
    for (const [p, kid] of [[rootPid, childPid], [childPid, grandPid]] as const) {
      mkdirSync(join(procDir, String(p), 'task', String(p)), { recursive: true });
      writeFileSync(join(procDir, String(p), 'task', String(p), 'children'), `${kid}\n`);
    }
    mkdirSync(join(procDir, String(grandPid)), { recursive: true });
    writeLinuxStat(procDir, childPid, 'S', rootPid, rootPid, 222);
    writeLinuxStat(procDir, grandPid, 'S', childPid, rootPid, 333);
    let rootKills = 0;
    const signaled: number[] = [];
    const signalPid = (pid: number): Error | undefined => { signaled.push(pid); writeLinuxStat(procDir, pid, 'Z', 1, 1, 0); return undefined; };
    const root = { pid: rootPid, exitCode: null as number | null, signalCode: null, kill: () => { rootKills += 1; root.exitCode = 0; return true; } };
    await expect(Promise.resolve(killProcessTree(root, procDir, signalPid))).rejects.toThrow('DESCENDANT_IDENTITY_UNVERIFIED');
    expect([rootKills, signaled, isPidAlive(childPid, procDir)]).toEqual([0, [], true]);

    writeLinuxStat(procDir, rootPid, 'S', 1, rootPid, 111);
    rmSync(join(procDir, String(grandPid), 'stat'));
    await expect(Promise.resolve(killProcessTree(root, procDir, signalPid))).rejects.toThrow('DESCENDANT_IDENTITY_UNVERIFIED');
    expect([rootKills, signaled, isPidAlive(childPid, procDir), isPidAlive(grandPid, procDir)]).toEqual([0, [], true, true]);

    writeLinuxStat(procDir, grandPid, 'S', childPid, rootPid, 333);
    await expect(Promise.resolve(killProcessTree(root, procDir, signalPid))).resolves.toBeUndefined();
    expect([rootKills, new Set(signaled), isPidAlive(childPid, procDir), isPidAlive(grandPid, procDir)]).toEqual([1, new Set([childPid, grandPid]), false, false]);

    signaled.length = 0;
    const closingTarget = { pid: rootPid, exitCode: null as number | null, signalCode: null, kill: () => { rootKills += 1; closingTarget.exitCode = 0; return true; } };
    const closingRoot = createMarkerProcess('closing-marker', () => closingTarget);
    rmSync(join(procDir, String(grandPid)), { recursive: true, force: true });
    writeFileSync(join(procDir, String(childPid), 'task', String(childPid), 'children'), '');
    writeLinuxStat(procDir, childPid, 'S', rootPid, childPid, 222);
    captureOwnedDescendants(closingRoot, procDir);
    closingTarget.exitCode = 0;
    rmSync(join(procDir, String(rootPid)), { recursive: true, force: true });
    rmSync(join(procDir, String(childPid), 'stat'));
    await expect(Promise.resolve(killProcessTree(closingRoot, procDir, signalPid))).rejects.toThrow('DESCENDANT_IDENTITY_UNVERIFIED');
    expect([rootKills, signaled, isPidAlive(childPid, procDir)]).toEqual([1, [], true]);

    writeLinuxStat(procDir, childPid, 'S', 1, childPid, 222);
    const signalWithLateFork = (pid: number): Error | undefined => {
      if (pid === childPid) { mkdirSync(join(procDir, String(grandPid)), { recursive: true }); writeLinuxStat(procDir, grandPid, 'S', 1, childPid, 333); }
      return signalPid(pid);
    };
    await expect(Promise.resolve(killProcessTree(closingRoot, procDir, signalWithLateFork))).rejects.toThrow('DESCENDANT_IDENTITY_UNVERIFIED');
    expect([rootKills, signaled, isPidAlive(childPid, procDir), isPidAlive(grandPid, procDir)]).toEqual([1, [childPid], false, true]);

    writeFileSync(join(procDir, String(grandPid), 'environ'), `${LAUNCH_MARKER_ENV}=closing-marker\0`);
    await expect(Promise.resolve(killProcessTree(closingRoot, procDir, signalWithLateFork))).resolves.toBeUndefined();
    expect([rootKills, signaled, isPidAlive(childPid, procDir), isPidAlive(grandPid, procDir)]).toEqual([1, [childPid, grandPid], false, false]);
  } finally {
    for (const s of [sRoot, sChild, sGrand]) try { s.kill('SIGKILL'); } catch { /* exited */ }
    rmSync(procDir, { recursive: true, force: true });
  }
});

it('walks children of reparented group members across distinct process groups', async () => {
  const procDir = mkdtempSync(join(tmpdir(), 'pospay-proc-grp-'));
  const spawnSleeper = () => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], { detached: true, stdio: 'ignore' });
  const [sRoot, sChild, sHelper, sGrand] = [spawnSleeper(), spawnSleeper(), spawnSleeper(), spawnSleeper()];
  const [rootPid, childPid, helperPid, grandPid] = [sRoot.pid ?? 0, sChild.pid ?? 0, sHelper.pid ?? 0, sGrand.pid ?? 0];
  const writeChildren = (pid: number, kids: readonly number[]): void => {
    mkdirSync(join(procDir, String(pid), 'task', String(pid)), { recursive: true });
    writeFileSync(join(procDir, String(pid), 'task', String(pid), 'children'), kids.join(' '));
  };
  expect(Math.min(rootPid, childPid, helperPid, grandPid)).toBeGreaterThan(0);
  try {
    writeChildren(rootPid, [childPid]);
    writeLinuxStat(procDir, rootPid, 'S', 1, rootPid, 111);
    writeChildren(childPid, []);
    writeLinuxStat(procDir, childPid, 'S', rootPid, childPid, 222);
    writeChildren(helperPid, [grandPid]);
    writeLinuxStat(procDir, helperPid, 'S', 1, childPid, 333);
    mkdirSync(join(procDir, String(grandPid)), { recursive: true });
    writeLinuxStat(procDir, grandPid, 'S', helperPid, grandPid, 444);
    const signaled: number[] = [];
    const signalPid = (pid: number): Error | undefined => { signaled.push(pid); writeLinuxStat(procDir, pid, 'Z', 1, 1, 0); return undefined; };
    const closingTarget = { pid: rootPid, exitCode: null as number | null, signalCode: null, kill: () => { closingTarget.exitCode = 0; return true; } };
    const closingRoot = createMarkerProcess('grp-retained-marker', () => closingTarget);
    captureOwnedDescendants(closingRoot, procDir);
    closingTarget.exitCode = 0;
    for (const p of [rootPid, childPid, helperPid]) writeLinuxStat(procDir, p, 'Z', 1, 1, 0);
    await expect(Promise.resolve(killProcessTree(closingRoot, procDir, signalPid))).resolves.toBeUndefined();
    expect([signaled, isPidAlive(grandPid, procDir)]).toEqual([[grandPid], false]);

    signaled.length = 0;
    writeLinuxStat(procDir, rootPid, 'S', 1, rootPid, 111);
    writeLinuxStat(procDir, childPid, 'S', rootPid, childPid, 222);
    for (const p of [helperPid, grandPid]) rmSync(join(procDir, String(p)), { recursive: true, force: true });
    const failTarget = { pid: rootPid, exitCode: null as number | null, signalCode: null, kill: () => { failTarget.exitCode = 0; return true; } };
    const failRoot = createMarkerProcess('grp-unverified-marker', () => failTarget);
    captureOwnedDescendants(failRoot, procDir);
    failTarget.exitCode = 0;
    rmSync(join(procDir, String(rootPid)), { recursive: true, force: true });
    writeLinuxStat(procDir, childPid, 'S', 1, childPid, 222);
    const signalWithLateReparented = (pid: number): Error | undefined => {
      if (pid === childPid) {
        writeChildren(helperPid, [grandPid]);
        writeLinuxStat(procDir, helperPid, 'S', 1, childPid, 333);
        mkdirSync(join(procDir, String(grandPid)), { recursive: true });
        writeLinuxStat(procDir, grandPid, 'S', helperPid, grandPid, 444);
      }
      return signalPid(pid);
    };
    await expect(Promise.resolve(killProcessTree(failRoot, procDir, signalWithLateReparented))).rejects.toThrow('DESCENDANT_IDENTITY_UNVERIFIED');
    expect([signaled, isPidAlive(helperPid, procDir), isPidAlive(grandPid, procDir)]).toEqual([[childPid], true, true]);
    writeLinuxStat(procDir, helperPid, 'Z', 1, 1, 0);
    await expect(Promise.resolve(killProcessTree(failRoot, procDir, signalWithLateReparented))).rejects.toThrow('DESCENDANT_IDENTITY_UNVERIFIED');
    expect([signaled, isPidAlive(helperPid, procDir), isPidAlive(grandPid, procDir)]).toEqual([[childPid], false, true]);
  } finally {
    for (const s of [sRoot, sChild, sHelper, sGrand]) try { s.kill('SIGKILL'); } catch { /* exited */ }
    rmSync(procDir, { recursive: true, force: true });
  }
});

it('falls back to live process-group ownership when parent exits between discovery and verification', async () => {
  const procDir = mkdtempSync(join(tmpdir(), 'pospay-proc-race-'));
  const spawnSleeper = () => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], { detached: true, stdio: 'ignore' });
  const [sRoot, sChild, sGrand] = [spawnSleeper(), spawnSleeper(), spawnSleeper()];
  const [rootPid, childPid, grandPid] = [sRoot.pid ?? 0, sChild.pid ?? 0, sGrand.pid ?? 0];
  const writeChildren = (pid: number, kids: readonly number[]): void => {
    mkdirSync(join(procDir, String(pid), 'task', String(pid)), { recursive: true });
    writeFileSync(join(procDir, String(pid), 'task', String(pid), 'children'), kids.join(' '));
  };
  expect(Math.min(rootPid, childPid, grandPid)).toBeGreaterThan(0);
  const origKill = process.kill.bind(process);
  let reparented = false;
  const killSpy = vi.spyOn(process, 'kill').mockImplementation(((pid: number, sig?: string | number) => {
    if (!reparented && pid === childPid && sig === 0) {
      reparented = true;
      writeLinuxStat(procDir, childPid, 'Z', 1, 1, 0);
      rmSync(join(procDir, String(childPid), 'task'), { recursive: true, force: true });
      writeLinuxStat(procDir, grandPid, 'S', 1, rootPid, 333);
    }
    return origKill(pid, sig as NodeJS.Signals);
  }) as typeof process.kill);
  try {
    writeChildren(rootPid, [childPid]);
    writeLinuxStat(procDir, rootPid, 'S', 1, rootPid, 111);
    writeChildren(childPid, [grandPid]);
    writeLinuxStat(procDir, childPid, 'S', rootPid, rootPid, 222);
    mkdirSync(join(procDir, String(grandPid)), { recursive: true });
    writeLinuxStat(procDir, grandPid, 'S', childPid, rootPid, 333);
    const signaled: number[] = [];
    const signalPid = (pid: number): Error | undefined => { signaled.push(pid); writeLinuxStat(procDir, pid, 'Z', 1, 1, 0); return undefined; };
    const raceTarget = { pid: rootPid, exitCode: null as number | null, signalCode: null, kill: () => { raceTarget.exitCode = 0; return true; } };
    await expect(Promise.resolve(killProcessTree(createMarkerProcess('grp-race-marker', () => raceTarget), procDir, signalPid))).resolves.toBeUndefined();
    expect([signaled, isPidAlive(grandPid, procDir)]).toEqual([[grandPid], false]);
  } finally {
    killSpy.mockRestore();
    for (const s of [sRoot, sChild, sGrand]) try { s.kill('SIGKILL'); } catch { /* exited */ }
    rmSync(procDir, { recursive: true, force: true });
  }
});

it('handles ESRCH, false kill returns, and reused root PIDs on post-exit rescan', async () => {
  const procDir = mkdtempSync(join(tmpdir(), 'pospay-proc-empty-'));
  const spawnSleeper = () => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], { detached: true, stdio: 'ignore' });
  const [sRoot, sEscaped, sHelper] = [spawnSleeper(), spawnSleeper(), spawnSleeper()];
  const [rootPid, escapedPid, helperPid] = [sRoot.pid ?? 0, sEscaped.pid ?? 0, sHelper.pid ?? 0];
  const esrchError = () => Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
  expect(Math.min(rootPid, escapedPid, helperPid)).toBeGreaterThan(0);
  try {
    mkdirSync(join(procDir, String(rootPid)), { recursive: true });
    writeLinuxStat(procDir, rootPid, 'S', 1, rootPid, 111);
    const signaled: number[] = [];
    const signalPid = (pid: number): Error | undefined => { signaled.push(pid); writeLinuxStat(procDir, pid, 'Z', 1, 1, 0); return undefined; };

    const liveFalseRoot = { pid: rootPid, exitCode: null as number | null, signalCode: null, once: () => undefined, kill: () => false };
    await expect(Promise.resolve(killProcessTree(createMarkerProcess('false-live-marker', () => liveFalseRoot), procDir, signalPid))).rejects.toThrow('SIGKILL_REJECTED');

    const goneFalseRoot = {
      pid: rootPid, exitCode: null as number | null, signalCode: null, once: () => undefined,
      kill: () => {
        writeLinuxStat(procDir, rootPid, 'Z', 1, 1, 0);
        mkdirSync(join(procDir, String(escapedPid)), { recursive: true });
        writeLinuxStat(procDir, escapedPid, 'S', 1, escapedPid, 555);
        writeFileSync(join(procDir, String(escapedPid), 'environ'), `${LAUNCH_MARKER_ENV}=false-gone-marker\0`);
        return false;
      },
    };
    await expect(Promise.resolve(killProcessTree(createMarkerProcess('false-gone-marker', () => goneFalseRoot), procDir, signalPid))).resolves.toBeUndefined();
    expect([signaled, isPidAlive(escapedPid, procDir)]).toEqual([[escapedPid], false]);

    signaled.length = 0;
    writeLinuxStat(procDir, rootPid, 'S', 1, rootPid, 111);
    const unmarkedGroupRoot = {
      pid: rootPid, exitCode: null as number | null, signalCode: null, once: () => undefined,
      kill: () => {
        writeLinuxStat(procDir, rootPid, 'Z', 1, 1, 0);
        mkdirSync(join(procDir, String(helperPid)), { recursive: true });
        writeLinuxStat(procDir, helperPid, 'S', 1, rootPid, 444);
        throw esrchError();
      },
    };
    await expect(Promise.resolve(killProcessTree(createMarkerProcess('esrch-group-marker', () => unmarkedGroupRoot), procDir, signalPid))).rejects.toThrow('DESCENDANT_IDENTITY_UNVERIFIED');
    expect([signaled, isPidAlive(helperPid, procDir)]).toEqual([[], true]);

    writeLinuxStat(procDir, helperPid, 'Z', 1, 1, 0);
    writeLinuxStat(procDir, rootPid, 'S', 1, rootPid, 111);
    const reusedPidRoot = {
      pid: rootPid, exitCode: null as number | null, signalCode: null, once: () => undefined,
      kill: () => {
        writeLinuxStat(procDir, rootPid, 'S', 1, rootPid, 999);
        writeLinuxStat(procDir, helperPid, 'S', rootPid, rootPid, 666);
        throw esrchError();
      },
    };
    await expect(Promise.resolve(killProcessTree(createMarkerProcess('esrch-reuse-marker', () => reusedPidRoot), procDir, signalPid))).resolves.toBeUndefined();
    expect([signaled, isPidAlive(helperPid, procDir)]).toEqual([[], true]);
  } finally {
    for (const s of [sRoot, sEscaped, sHelper]) try { s.kill('SIGKILL'); } catch { /* exited */ }
    rmSync(procDir, { recursive: true, force: true });
  }
});

it('waits for root exit after true kill return without once before rescanning marked descendants', async () => {
  const procDir = mkdtempSync(join(tmpdir(), 'pospay-proc-poll-'));
  const spawnSleeper = () => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], { detached: true, stdio: 'ignore' });
  const [sRoot, sChild, sEscaped] = [spawnSleeper(), spawnSleeper(), spawnSleeper()];
  const [rootPid, childPid, escapedPid] = [sRoot.pid ?? 0, sChild.pid ?? 0, sEscaped.pid ?? 0];
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  const origSetTimeout = globalThis.setTimeout;
  const pollTimers: Array<ReturnType<typeof setTimeout>> = [];
  const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const timer = origSetTimeout(fn, ms, ...args);
    if (ms === 10) pollTimers.push(timer);
    return timer;
  }) as typeof setTimeout);
  expect(Math.min(rootPid, childPid, escapedPid)).toBeGreaterThan(0);
  try {
    mkdirSync(join(procDir, String(rootPid)), { recursive: true });
    writeLinuxStat(procDir, rootPid, 'S', 1, rootPid, 111);
    const signaled: number[] = [];
    const signalPid = (pid: number): Error | undefined => { signaled.push(pid); writeLinuxStat(procDir, pid, 'Z', 1, 1, 0); return undefined; };
    const delayedExitRoot = {
      pid: rootPid, exitCode: null as number | null, signalCode: null,
      kill: () => {
        exitTimer = origSetTimeout(() => {
          writeLinuxStat(procDir, rootPid, 'Z', 1, 1, 0);
          mkdirSync(join(procDir, String(escapedPid)), { recursive: true });
          writeLinuxStat(procDir, escapedPid, 'S', 1, escapedPid, 555);
          writeFileSync(join(procDir, String(escapedPid), 'environ'), `${LAUNCH_MARKER_ENV}=poll-root-marker\0`);
        }, 30);
        return true;
      },
    };
    const killTask = killProcessTree(createMarkerProcess('poll-root-marker', () => delayedExitRoot), procDir, signalPid) as Promise<void> & { unref?: () => void };
    await new Promise((r) => origSetTimeout(r, 15));
    expect(pollTimers.at(-1)?.hasRef()).toBe(true);
    killTask.unref?.();
    expect(pollTimers.at(-1)?.hasRef()).toBe(false);
    await expect(killTask).resolves.toBeUndefined();
    expect([signaled, isPidAlive(escapedPid, procDir)]).toEqual([[escapedPid], false]);
  } finally {
    timeoutSpy.mockRestore();
    if (exitTimer !== undefined) clearTimeout(exitTimer);
    for (const s of [sRoot, sChild, sEscaped]) try { s.kill('SIGKILL'); } catch { /* exited */ }
    rmSync(procDir, { recursive: true, force: true });
  }
});

it('aborts descendant signaling immediately when identity changes mid-loop', async () => {
  const procDir = mkdtempSync(join(tmpdir(), 'pospay-proc-recheck-'));
  const spawnSleeper = () => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], { detached: true, stdio: 'ignore' });
  const [sRoot, sChild, sGrand] = [spawnSleeper(), spawnSleeper(), spawnSleeper()];
  const [rootPid, childPid, grandPid] = [sRoot.pid ?? 0, sChild.pid ?? 0, sGrand.pid ?? 0];
  expect(Math.min(rootPid, childPid, grandPid)).toBeGreaterThan(0);
  try {
    for (const [p, kid] of [[rootPid, childPid], [childPid, grandPid]] as const) {
      mkdirSync(join(procDir, String(p), 'task', String(p)), { recursive: true });
      writeFileSync(join(procDir, String(p), 'task', String(p), 'children'), `${kid}\n`);
    }
    mkdirSync(join(procDir, String(grandPid)), { recursive: true });
    writeLinuxStat(procDir, rootPid, 'S', 1, rootPid, 111);
    writeLinuxStat(procDir, childPid, 'S', rootPid, rootPid, 222);
    writeLinuxStat(procDir, grandPid, 'S', childPid, rootPid, 333);
    const signaled: number[] = [];
    const abortMidLoop = (pid: number): Error | undefined => {
      if (pid === childPid) rmSync(join(procDir, String(grandPid), 'stat'));
      signaled.push(pid);
      writeLinuxStat(procDir, pid, 'Z', 1, 1, 0);
      return undefined;
    };
    let raceKills = 0;
    const raceRoot = { pid: rootPid, exitCode: null as number | null, signalCode: null, kill: () => { raceKills += 1; raceRoot.exitCode = 0; return true; } };
    await expect(Promise.resolve(killProcessTree(raceRoot, procDir, abortMidLoop))).rejects.toThrow('DESCENDANT_IDENTITY_UNVERIFIED');
    expect([raceKills, signaled, isPidAlive(childPid, procDir), isPidAlive(grandPid, procDir)]).toEqual([0, [childPid], false, true]);
  } finally {
    for (const s of [sRoot, sChild, sGrand]) try { s.kill('SIGKILL'); } catch { /* exited */ }
    rmSync(procDir, { recursive: true, force: true });
  }
});
