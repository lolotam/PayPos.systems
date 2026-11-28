import { expect, it } from 'vitest';

import type { PdfBrowser } from '../playwright/browser.ts';
import { PlaywrightDocumentRenderer } from '../playwright/renderer.ts';

function okBrowser(overrides: Partial<PdfBrowser> = {}): PdfBrowser {
  return {
    newContext: () => new Promise(() => undefined),
    close: async () => undefined,
    on: () => undefined,
    ...overrides,
  };
}

async function waitAvailable(renderer: PlaywrightDocumentRenderer): Promise<void> {
  for (let i = 0; i < 40 && !renderer.isAvailable(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function delayedLaunchFactory(onLaunch: (attempt: number) => Promise<PdfBrowser>) {
  let launches = 0;
  return {
    launches: () => launches,
    factory: {
      launch: () => {
        launches += 1;
        return onLaunch(launches);
      },
    },
  };
}

it('does not overlap manual start during retirement with post-retirement relaunch past backoff', async () => {
  let releaseSecond: (() => void) | undefined;
  const spy = delayedLaunchFactory(async (attempt) => {
    if (attempt === 1) {
      return okBrowser({ close: () => new Promise((resolve) => setTimeout(resolve, 40)) });
    }
    return new Promise<PdfBrowser>((resolve) => {
      releaseSecond = () => resolve(okBrowser());
    });
  });
  const renderer = new PlaywrightDocumentRenderer({
    factory: spy.factory,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    backoffMs: [10],
    overallTimeoutMs: 15,
    browserCloseGraceMs: 5,
  });
  await renderer.start();
  await expect(renderer.render('<p>x</p>')).rejects.toThrow();
  const manualStart = renderer.start();
  await new Promise((resolve) => setTimeout(resolve, 90));
  expect(spy.launches()).toBe(2);
  releaseSecond?.();
  await manualStart;
  expect(spy.launches()).toBe(2);
  expect(renderer.isAvailable()).toBe(true);
  await renderer.close();
});

it('waits for retirement when an onUnavailable listener calls start synchronously', async () => {
  const events: string[] = [];
  const spy = delayedLaunchFactory(async (attempt) => {
    events.push(`launch-${attempt}`);
    if (attempt === 1) {
      return okBrowser({
        close: async () => {
          await new Promise((resolve) => setTimeout(resolve, 45));
          events.push('retire-closed');
        },
      });
    }
    return okBrowser();
  });
  const renderer = new PlaywrightDocumentRenderer({
    factory: spy.factory,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    backoffMs: [10],
    overallTimeoutMs: 15,
    browserCloseGraceMs: 100,
  });
  renderer.onUnavailable(() => void renderer.start());
  await renderer.start();
  await expect(renderer.render('<p>x</p>')).rejects.toThrow();
  await waitAvailable(renderer);
  expect(spy.launches()).toBe(2);
  expect(events).toEqual(['launch-1', 'retire-closed', 'launch-2']);
  await renderer.close();
});

it('does not schedule background relaunch when an external start signal aborts', async () => {
  let rejectFirst!: (error: Error) => void;
  const spy = delayedLaunchFactory(() => new Promise<PdfBrowser>((_resolve, reject) => (rejectFirst = reject)));
  const renderer = new PlaywrightDocumentRenderer({
    factory: spy.factory,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    backoffMs: [10],
  });
  const controller = new AbortController();
  const first = renderer.start({ signal: controller.signal });
  controller.abort();
  await first;
  rejectFirst(new Error('aborted launch failed'));
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(spy.launches()).toBe(1);
  await renderer.close();
});

it('keeps launch guard until a cancelled attempt closes its late browser', async () => {
  const events: string[] = [];
  let releaseFirst: ((b: PdfBrowser) => void) | undefined;
  const spy = delayedLaunchFactory((attempt) => {
    events.push(`launch-${attempt}`);
    if (attempt === 1) return new Promise<PdfBrowser>((resolve) => (releaseFirst = resolve));
    return Promise.resolve(okBrowser());
  });
  const renderer = new PlaywrightDocumentRenderer({
    factory: spy.factory,
    closeGraceMs: 80,
    backoffMs: [10],
  });
  const controller = new AbortController();
  const cancelled = renderer.start({ signal: controller.signal });
  controller.abort();
  setTimeout(() => {
    releaseFirst?.(
      okBrowser({
        close: async () => {
          await new Promise((resolve) => setTimeout(resolve, 35));
          events.push('late-closed');
        },
      }),
    );
  }, 15);
  await cancelled;
  await renderer.start();
  expect(events).toEqual(['launch-1', 'late-closed', 'launch-2']);
  await renderer.close();
});

it('holds the launch guard until a timed-out launch closes its late browser', async () => {
  const events: string[] = [];
  let releaseFirst: ((b: PdfBrowser) => void) | undefined;
  const spy = delayedLaunchFactory((attempt) => {
    events.push(`launch-${attempt}`);
    if (attempt === 1) return new Promise<PdfBrowser>((resolve) => (releaseFirst = resolve));
    return Promise.resolve(okBrowser());
  });
  const renderer = new PlaywrightDocumentRenderer({
    factory: spy.factory,
    launchTimeoutMs: 20,
    closeGraceMs: 80,
    backoffMs: [0],
    sleep: async () => undefined,
  });
  await renderer.start();
  expect(events).toEqual(['launch-1']);
  setTimeout(() => {
    releaseFirst?.(
      okBrowser({
        close: async () => {
          await new Promise((resolve) => setTimeout(resolve, 35));
          events.push('late-timeout-closed');
        },
      }),
    );
  }, 10);
  await waitAvailable(renderer);
  expect(events).toEqual(['launch-1', 'late-timeout-closed', 'launch-2']);
  await renderer.close();
});

it('aborts wait during retirement cleanly and still schedules relaunch after retirement', async () => {
  let releaseKill: (() => void) | undefined;
  const spy = delayedLaunchFactory(async (attempt) => {
    if (attempt === 1) {
      return okBrowser({
        close: () => new Promise<void>(() => undefined),
        kill: () => new Promise<void>((r) => (releaseKill = r)),
      });
    }
    return okBrowser();
  });
  const renderer = new PlaywrightDocumentRenderer({
    factory: spy.factory,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    backoffMs: [5],
    overallTimeoutMs: 15,
    browserCloseGraceMs: 5,
  });
  await renderer.start();
  await expect(renderer.render('<p>x</p>')).rejects.toThrow();
  for (let i = 0; i < 20 && releaseKill === undefined; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(releaseKill).toBeDefined();
  const ac = new AbortController();
  const abortedStart = renderer.start({ signal: ac.signal });
  ac.abort();
  await abortedStart;
  expect(spy.launches()).toBe(1);
  releaseKill?.();
  await waitAvailable(renderer);
  expect(spy.launches()).toBe(2);
  expect(renderer.isAvailable()).toBe(true);
  await renderer.close();
});

it('reports unconfirmed retirement and keeps replacement gated until close finishes without kill', async () => {
  let releaseClose: (() => void) | undefined;
  const errors: unknown[] = [];
  const spy = delayedLaunchFactory(async (attempt) => {
    if (attempt === 1) {
      return okBrowser({ close: () => new Promise<void>((r) => (releaseClose = r)) });
    }
    return okBrowser();
  });
  const renderer = new PlaywrightDocumentRenderer({
    factory: spy.factory,
    sleep: async () => undefined,
    backoffMs: [0],
    overallTimeoutMs: 15,
    browserCloseGraceMs: 10,
    onLaunchError: (err) => errors.push(err),
  });
  await renderer.start();
  await expect(renderer.render('<p>x</p>')).rejects.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 560));
  expect(spy.launches()).toBe(1);
  expect(errors.some((e) => e instanceof Error && e.message === 'DOCUMENT_RETIRE_UNCONFIRMED')).toBe(true);
  releaseClose?.();
  await waitAvailable(renderer);
  expect(spy.launches()).toBe(2);
  expect(renderer.isAvailable()).toBe(true);
  await renderer.close();
});

it('escalates onUnconfirmedExit when retirement exit never confirms while keeping replacement blocked', async () => {
  let launches = 0;
  const escalated: Error[] = [];
  const spy = delayedLaunchFactory(async () => {
    launches += 1;
    return okBrowser({ close: () => new Promise<void>(() => undefined) });
  });
  const renderer = new PlaywrightDocumentRenderer({
    factory: spy.factory,
    sleep: async () => undefined,
    backoffMs: [0],
    overallTimeoutMs: 15,
    browserCloseGraceMs: 10,
    unconfirmedExitTimeoutMs: 30,
    onUnconfirmedExit: (err) => escalated.push(err),
  });
  await renderer.start();
  await expect(renderer.render('<p>x</p>')).rejects.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 560));
  expect(launches).toBe(1);
  expect(escalated.map((e) => e.message)).toContain('DOCUMENT_RETIRE_UNCONFIRMED');
  await renderer.close();
});

it('closes the browser and gates replacement start when abort lands during post-launch handoff', async () => {
  const events: string[] = [];
  let releaseFirst: ((b: PdfBrowser) => void) | undefined;
  let releaseClose: (() => void) | undefined;
  const spy = delayedLaunchFactory((attempt) => {
    events.push(`launch-${attempt}`);
    if (attempt === 1) return new Promise<PdfBrowser>((resolve) => (releaseFirst = resolve));
    return Promise.resolve(okBrowser());
  });
  const renderer = new PlaywrightDocumentRenderer({
    factory: spy.factory,
    closeGraceMs: 30,
    backoffMs: [10],
  });
  const ac = new AbortController();
  const cancelled = renderer.start({ signal: ac.signal });
  setTimeout(() => {
    releaseFirst?.(
      okBrowser({
        close: () => {
          events.push('handoff-close-start');
          return new Promise<void>((resolve) => {
            releaseClose = () => {
              events.push('handoff-close-done');
              resolve();
            };
          });
        },
      }),
    );
    queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => ac.abort())));
  }, 5);
  await cancelled;
  expect(renderer.isAvailable()).toBe(false);
  const replacement = renderer.start();
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(spy.launches()).toBe(1);
  releaseClose?.();
  await replacement;
  expect(events).toEqual(['launch-1', 'handoff-close-start', 'handoff-close-done', 'launch-2']);
  expect(renderer.isAvailable()).toBe(true);
  await renderer.close();
});

it('retains the browser handle after a synchronous kill() throw so a later close() confirms exit', async () => {
  let closeCalls = 0;
  let releaseClose: (() => void) | undefined;
  const renderer = new PlaywrightDocumentRenderer({
    factory: {
      launch: async () =>
        okBrowser({
          close: () => {
            closeCalls += 1;
            return new Promise<void>((resolve) => {
              releaseClose = resolve;
            });
          },
          kill: () => {
            throw new Error('EPERM');
          },
        }),
    },
    closeGraceMs: 40,
  });
  await renderer.start();
  await expect(Promise.resolve(renderer.kill())).rejects.toThrow('EPERM');
  expect(renderer.unconfirmedExit).not.toBeNull();
  const closing = renderer.close();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(closeCalls).toBe(1);
  releaseClose?.();
  await closing;
  expect(renderer.unconfirmedExit).toBeNull();
});

it('clears the unconfirmed kill gate when an in-flight graceful close() subsequently succeeds', async () => {
  let releaseClose: (() => void) | undefined;
  const renderer = new PlaywrightDocumentRenderer({
    factory: {
      launch: async () =>
        okBrowser({
          close: () => new Promise<void>((resolve) => (releaseClose = resolve)),
          kill: () => Promise.reject(new Error('EPERM')),
        }),
    },
    closeGraceMs: 200,
  });
  await renderer.start();
  const closing = renderer.close();
  await expect(Promise.resolve(renderer.kill())).rejects.toThrow('EPERM');
  const pendingExit = renderer.unconfirmedExit;
  expect(pendingExit).not.toBeNull();
  releaseClose?.();
  await closing;
  await pendingExit;
  expect(renderer.unconfirmedExit).toBeNull();
});

it('allows kill() to terminate a launch-handoff browser immediately and avoids a second kill', async () => {
  let releaseLaunch!: (browser: PdfBrowser) => void;
  let closeCalls = 0;
  let killCalls = 0;
  const renderer = new PlaywrightDocumentRenderer({
    factory: { launch: () => new Promise<PdfBrowser>((resolve) => (releaseLaunch = resolve)) },
    closeGraceMs: 120,
  });
  const starting = renderer.start();
  let closing: Promise<void> | undefined;
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      releaseLaunch(
        okBrowser({
          close: () => {
            closeCalls += 1;
            return new Promise<void>(() => undefined);
          },
          kill: async () => {
            killCalls += 1;
          },
        }),
      );
      queueMicrotask(() => queueMicrotask(() => { closing = renderer.close(); resolve(); }));
    }, 5);
  });
  await new Promise<void>((resolve) => queueMicrotask(() => queueMicrotask(resolve)));
  expect(closeCalls).toBe(1);
  expect(killCalls).toBe(0);
  const startedKillAt = Date.now();
  await Promise.all([Promise.resolve(renderer.kill()), starting, closing]);
  expect(Date.now() - startedKillAt).toBeLessThan(80);
  expect(killCalls).toBe(1);
  await new Promise((resolve) => setTimeout(resolve, 180));
  expect(killCalls).toBe(1);
  expect(renderer.unconfirmedExit).toBeNull();
});
