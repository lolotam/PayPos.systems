import { EventEmitter } from 'node:events';
import { chromium } from 'playwright-core';
import { expect, it } from 'vitest';

import type { PdfBrowser } from '../playwright/browser.ts';
import { getLaunchCleanup, killAndWait, playwrightFactory, withLaunchCleanup } from '../playwright/factory.ts';
import { PlaywrightDocumentRenderer } from '../playwright/renderer.ts';
import { dropRetiredBrowser } from '../playwright/retire.ts';
import { realChromiumUnavailable } from './chromium-gate.ts';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function fakeBrowser(overrides: Partial<PdfBrowser> = {}): PdfBrowser {
  return { newContext: () => new Promise(() => undefined), close: () => new Promise(() => undefined), on: () => undefined, ...overrides };
}

// kill() بيوصل لعملية Chromium من جوّه Playwright؛ الاختبار ده بيثبت إنه لسه شغال على 1.63.0.
const browser = await playwrightFactory()
  .launch()
  .catch((error: unknown) => realChromiumUnavailable(error));

it.skipIf(browser === false)('kill() terminates the real Chromium process', async () => {
  if (browser === false) return;
  const gone = new Promise<void>((resolve) => {
    browser.on('disconnected', () => {
      resolve();
    });
  });
  expect(browser.kill).toBeTypeOf('function');
  await expect(Promise.resolve(browser.kill?.())).resolves.toBeUndefined();
  await expect(gone).resolves.toBeUndefined();
});

it.skipIf(browser === false)('attaches launch cleanup when pinned Playwright launcher fails after spawn', async () => {
  const pw = chromium as unknown as {
    _connection: { toImpl: (target: unknown) => { connectToTransport: (...a: unknown[]) => Promise<unknown> } };
  };
  const impl = pw._connection.toImpl(chromium);
  const orig = impl.connectToTransport;
  impl.connectToTransport = async () => { throw new Error('POST_SPAWN_TEST_FAIL'); };
  let caught: unknown;
  try {
    await playwrightFactory().launch();
  } catch (err) {
    caught = err;
  } finally {
    impl.connectToTransport = orig;
  }
  expect(caught).toBeInstanceOf(Error);
  const cleanup = getLaunchCleanup(caught);
  expect(cleanup).toBeDefined();
  await expect(cleanup).resolves.toBeUndefined();
});

it('keeps replacement launches blocked on rejected launch cleanup before and after timeout until retry confirms', async () => {
  for (const [timeoutMs, delayMs] of [[200, 0], [15, 35]] as const) {
    let launches = 0;
    let kills = 0;
    const errors: string[] = [];
    const renderer = new PlaywrightDocumentRenderer({
      factory: {
        launch: () => new Promise((_, reject) => {
          launches += 1;
          setTimeout(() => reject(withLaunchCleanup(new Error('spawn fail'), Promise.reject(new Error('SIGKILL_REJECTED')), () => { kills += 1; })), delayMs);
        }),
      },
      launchTimeoutMs: timeoutMs,
      sleep: wait,
      backoffMs: [0],
      onLaunchError: (err) => { if (err instanceof Error) errors.push(err.message); },
    });
    await renderer.start();
    await wait(delayMs + 40);
    expect(launches).toBe(1);
    expect(errors).toContain('SIGKILL_REJECTED');
    expect(renderer.unconfirmedExit).not.toBeNull();
    await Promise.resolve(renderer.kill());
    expect(kills).toBe(1);
    expect(renderer.unconfirmedExit).toBeNull();
  }
});

it('keeps killProcessTree pending for surviving descendants when root has already exited', async () => {
  const child = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null, kill: () => true });
  const root = Object.assign(new EventEmitter(), { exitCode: 0, signalCode: null, children: [child], kill: () => true });
  let done = false;
  const waiting = Promise.resolve(killAndWait(root)).then(() => { done = true; });
  await wait(20);
  expect(done).toBe(false);
  child.exitCode = 0;
  child.emit('exit');
  await waiting;
  expect(done).toBe(true);
});

it('preserves recovery across aborted starts, handles reentrant kill inside factory, and retries undefined kill rejections', async () => {
  let launches = 0;
  let releaseRetireKill: (() => void) | undefined;
  const retireRenderer = new PlaywrightDocumentRenderer({
    factory: { launch: async () => (++launches === 1 ? fakeBrowser({ kill: () => new Promise<void>((r) => (releaseRetireKill = r)) }) : fakeBrowser({ close: async () => undefined })) },
    sleep: wait,
    backoffMs: [0],
    overallTimeoutMs: 15,
    browserCloseGraceMs: 10,
  });
  await retireRenderer.start();
  await expect(retireRenderer.render('<p>x</p>')).rejects.toThrow();
  await wait(30);
  const ac1 = new AbortController();
  const s1 = retireRenderer.start({ signal: ac1.signal });
  ac1.abort();
  await s1;
  const ac2 = new AbortController();
  const s2 = retireRenderer.start({ signal: ac2.signal });
  releaseRetireKill?.();
  await wait(15);
  ac2.abort();
  await s2;
  for (let i = 0; i < 30 && launches < 2; i += 1) await wait(10);
  expect(launches).toBe(2);
  await retireRenderer.close();

  let releaseLate!: (b: PdfBrowser) => void;
  let reentrantKill: Promise<void> | undefined;
  let lateClosed = false;
  const reentrantRenderer = new PlaywrightDocumentRenderer({
    factory: { launch: () => { reentrantKill = Promise.resolve(reentrantRenderer.kill()); return new Promise((r) => (releaseLate = r)); } },
    closeGraceMs: 20,
  });
  const pendingStart = reentrantRenderer.start();
  await wait(10);
  releaseLate(fakeBrowser({ close: async () => { lateClosed = true; } }));
  await Promise.all([pendingStart, reentrantKill]);
  expect(lateClosed).toBe(true);
});

it('retains shutdown handle for abandoned late browsers and handles undefined kill rejections', async () => {
  let releaseLate!: (b: PdfBrowser) => void;
  let kills = 0;
  const renderer = new PlaywrightDocumentRenderer({
    factory: { launch: () => new Promise((r) => (releaseLate = r)) },
    launchTimeoutMs: 15,
    closeGraceMs: 15,
  });
  await renderer.start();
  releaseLate(fakeBrowser({ kill: () => (++kills === 1 ? Promise.reject() : Promise.resolve()) }));
  await wait(40);
  expect(renderer.unconfirmedExit).not.toBeNull();
  await Promise.resolve(renderer.kill());
  expect(kills).toBe(2);
  expect(renderer.unconfirmedExit).toBeNull();

  const undefRejected = await dropRetiredBrowser(fakeBrowser({ close: async () => undefined, kill: () => Promise.reject() }), 20);
  expect(undefRejected.confirmed).toBe(true);
});
