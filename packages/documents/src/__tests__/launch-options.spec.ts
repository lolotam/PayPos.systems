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
import { getLaunchCleanupRetry, killProcessTree } from '../playwright/process-tree.ts';

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
  const spy = vi.spyOn(chromium, 'launch').mockResolvedValue({
    newContext: async () =>
      ({
        route: async () => undefined,
        newPage: async () => ({}) as never,
        close: async () => undefined,
      }) as never,
    close: async () => undefined,
    on: () => undefined,
    process: () => ({ pid: 99_999, kill: () => true }),
  } as never);
  try {
    await playwrightFactory(12_345).launch();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ timeout: 12_345 }));
  } finally {
    spy.mockRestore();
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

it('holds root termination when root fingerprint is transiently unreadable for a readable unmarked child', async () => {
  const procDir = mkdtempSync(join(tmpdir(), 'pospay-proc-'));
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], { stdio: 'ignore' });
  const rootPid = process.pid;
  const childPid = sleeper.pid ?? 0;
  expect(childPid).toBeGreaterThan(0);
  try {
    mkdirSync(join(procDir, String(rootPid), 'task', String(rootPid)), { recursive: true });
    mkdirSync(join(procDir, String(childPid)), { recursive: true });
    writeFileSync(join(procDir, String(rootPid), 'task', String(rootPid), 'children'), `${childPid}\n`);
    writeFileSync(join(procDir, String(childPid), 'stat'), `${childPid} (child) S ${rootPid} 1 1 0 -1 0 0 0 0 0 0 0 0 0 0 0 1 0 222\n`);
    let rootKills = 0;
    const root = { pid: rootPid, exitCode: null as number | null, signalCode: null, kill: () => { rootKills += 1; root.exitCode = 0; sleeper.kill('SIGKILL'); return true; } };
    await expect(Promise.resolve(killProcessTree(root, procDir))).rejects.toThrow('DESCENDANT_IDENTITY_UNVERIFIED');
    expect([rootKills, root.exitCode]).toEqual([0, null]);
    writeFileSync(join(procDir, String(rootPid), 'stat'), `${rootPid} (root) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0 0 0 1 0 111\n`);
    await expect(Promise.resolve(killProcessTree(root, procDir))).resolves.toBeUndefined();
    expect(rootKills).toBe(1);
  } finally {
    try { sleeper.kill('SIGKILL'); } catch { /* exited */ }
    rmSync(procDir, { recursive: true, force: true });
  }
});
