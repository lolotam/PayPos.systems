import { chromium } from 'playwright-core';
import { expect, it, vi } from 'vitest';

import {
  DEFAULT_CHROMIUM_LAUNCH_TIMEOUT_MS,
  chromiumLaunchOptions,
  getLaunchCleanup,
  playwrightFactory,
} from '../playwright/factory.ts';
import { getLaunchCleanupRetry } from '../playwright/process-tree.ts';

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

it('keeps missing-PID launch cleanup tied directly to a single browser.close() call', async () => {
  const launchMissing = async (close: () => Promise<void>): Promise<unknown> => {
    const spy = vi.spyOn(chromium, 'launch').mockResolvedValue({ newContext: async () => ({}) as never, close, on: () => undefined, process: () => null } as never);
    try { await playwrightFactory(50).launch(); return undefined; } catch (err) { return err; } finally { spy.mockRestore(); }
  };

  let closed = false;
  const okErr = await launchMissing(async () => { closed = true; });
  expect((okErr as Error).message).toBe('CHROMIUM_PROCESS_UNAVAILABLE');
  expect(closed).toBe(true);
  expect(getLaunchCleanupRetry(okErr)).toBeUndefined();
  await expect(getLaunchCleanup(okErr)).resolves.toBeUndefined();

  let closeTries = 0;
  const rejErr = await launchMissing(() => { closeTries += 1; return Promise.reject(new Error('CLOSE_FAIL')); });
  expect(getLaunchCleanupRetry(rejErr)).toBeUndefined();
  await expect(getLaunchCleanup(rejErr)).rejects.toThrow('CLOSE_FAIL');
  expect(closeTries).toBe(1);

  let hungTries = 0;
  let releaseClose!: () => void;
  let closeHungDone = false;
  const hungErr = await launchMissing(() => { hungTries += 1; return new Promise<void>((r) => { releaseClose = r; }); });
  expect(getLaunchCleanupRetry(hungErr)).toBeUndefined();
  void getLaunchCleanup(hungErr)?.then(() => { closeHungDone = true; });
  await new Promise((r) => setTimeout(r, 20));
  expect([closeHungDone, hungTries]).toEqual([false, 1]);
  releaseClose();
  await expect(getLaunchCleanup(hungErr)).resolves.toBeUndefined();
  expect(closeHungDone).toBe(true);
});
