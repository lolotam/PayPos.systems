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

it('holds root and verified ancestors when root or grandchild fingerprint is transiently unreadable', async () => {
  const procDir = mkdtempSync(join(tmpdir(), 'pospay-proc-'));
  const spawnSleeper = () => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], { detached: true, stdio: 'ignore' });
  const [sRoot, sChild, sGrand] = [spawnSleeper(), spawnSleeper(), spawnSleeper()];
  const [rootPid, childPid, grandPid] = [sRoot.pid ?? 0, sChild.pid ?? 0, sGrand.pid ?? 0];
  const writeStat = (pid: number, state: string, ppid: number, pgrp: number, start: number): void =>
    writeFileSync(join(procDir, String(pid), 'stat'), `${pid} (p) ${state} ${ppid} ${pgrp} 1 0 -1 0 0 0 0 0 0 0 0 0 0 0 1 0 ${start}\n`);
  expect(Math.min(rootPid, childPid, grandPid)).toBeGreaterThan(0);
  try {
    for (const [p, kid] of [[rootPid, childPid], [childPid, grandPid]] as const) {
      mkdirSync(join(procDir, String(p), 'task', String(p)), { recursive: true });
      writeFileSync(join(procDir, String(p), 'task', String(p), 'children'), `${kid}\n`);
    }
    mkdirSync(join(procDir, String(grandPid)), { recursive: true });
    writeStat(childPid, 'S', rootPid, rootPid, 222);
    writeStat(grandPid, 'S', childPid, rootPid, 333);
    let rootKills = 0;
    const signaled: number[] = [];
    const signalPid = (pid: number): Error | undefined => { signaled.push(pid); writeStat(pid, 'Z', 1, 1, 0); return undefined; };
    const root = { pid: rootPid, exitCode: null as number | null, signalCode: null, kill: () => { rootKills += 1; root.exitCode = 0; return true; } };
    await expect(Promise.resolve(killProcessTree(root, procDir, signalPid))).rejects.toThrow('DESCENDANT_IDENTITY_UNVERIFIED');
    expect([rootKills, signaled, isPidAlive(childPid, procDir)]).toEqual([0, [], true]);

    writeStat(rootPid, 'S', 1, rootPid, 111);
    rmSync(join(procDir, String(grandPid), 'stat'));
    await expect(Promise.resolve(killProcessTree(root, procDir, signalPid))).rejects.toThrow('DESCENDANT_IDENTITY_UNVERIFIED');
    expect([rootKills, signaled, isPidAlive(childPid, procDir), isPidAlive(grandPid, procDir)]).toEqual([0, [], true, true]);

    writeStat(grandPid, 'S', childPid, rootPid, 333);
    await expect(Promise.resolve(killProcessTree(root, procDir, signalPid))).resolves.toBeUndefined();
    expect([rootKills, new Set(signaled), isPidAlive(childPid, procDir), isPidAlive(grandPid, procDir)]).toEqual([1, new Set([childPid, grandPid]), false, false]);

    signaled.length = 0;
    const closingTarget = { pid: rootPid, exitCode: null as number | null, signalCode: null, kill: () => { rootKills += 1; closingTarget.exitCode = 0; return true; } };
    const closingRoot = createMarkerProcess('closing-marker', () => closingTarget);
    rmSync(join(procDir, String(grandPid)), { recursive: true, force: true });
    writeFileSync(join(procDir, String(childPid), 'task', String(childPid), 'children'), '');
    writeStat(childPid, 'S', rootPid, childPid, 222);
    captureOwnedDescendants(closingRoot, procDir);
    closingTarget.exitCode = 0;
    rmSync(join(procDir, String(rootPid)), { recursive: true, force: true });
    rmSync(join(procDir, String(childPid), 'stat'));
    await expect(Promise.resolve(killProcessTree(closingRoot, procDir, signalPid))).rejects.toThrow('DESCENDANT_IDENTITY_UNVERIFIED');
    expect([rootKills, signaled, isPidAlive(childPid, procDir)]).toEqual([1, [], true]);

    writeStat(childPid, 'S', 1, childPid, 222);
    const signalWithLateFork = (pid: number): Error | undefined => {
      if (pid === childPid) { mkdirSync(join(procDir, String(grandPid)), { recursive: true }); writeStat(grandPid, 'S', 1, childPid, 333); }
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
