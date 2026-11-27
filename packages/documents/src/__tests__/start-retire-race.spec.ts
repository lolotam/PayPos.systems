import { expect, it } from 'vitest';

import type { PdfBrowser } from '../playwright/browser.ts';
import { PlaywrightDocumentRenderer } from '../playwright/renderer.ts';

function okBrowser(): PdfBrowser {
  return {
    newContext: () => new Promise(() => undefined),
    close: async () => undefined,
    on: () => undefined,
  };
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
      return {
        newContext: () => new Promise(() => undefined),
        close: () => new Promise((resolve) => setTimeout(resolve, 40)),
        on: () => undefined,
      };
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
      return {
        newContext: () => new Promise(() => undefined),
        close: async () => {
          await new Promise((resolve) => setTimeout(resolve, 45));
          events.push('retire-closed');
        },
        on: () => undefined,
      };
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
  renderer.onUnavailable(() => {
    void renderer.start();
  });
  await renderer.start();
  await expect(renderer.render('<p>x</p>')).rejects.toThrow();
  for (let i = 0; i < 30 && !renderer.isAvailable(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(spy.launches()).toBe(2);
  expect(events).toEqual(['launch-1', 'retire-closed', 'launch-2']);
  await renderer.close();
});

it('does not schedule background relaunch when an external start signal aborts', async () => {
  const spy = delayedLaunchFactory(() => new Promise<PdfBrowser>(() => undefined));
  const renderer = new PlaywrightDocumentRenderer({
    factory: spy.factory,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    backoffMs: [10],
  });
  const controller = new AbortController();
  const first = renderer.start({ signal: controller.signal });
  controller.abort();
  await first;
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(spy.launches()).toBe(1);
  await renderer.close();
});

it('keeps launch guard until a cancelled attempt closes its late browser', async () => {
  const events: string[] = [];
  let releaseFirst: ((b: PdfBrowser) => void) | undefined;
  const spy = delayedLaunchFactory((attempt) => {
    events.push(`launch-${attempt}`);
    if (attempt === 1) {
      return new Promise<PdfBrowser>((resolve) => {
        releaseFirst = resolve;
      });
    }
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
    releaseFirst?.({
      newContext: () => new Promise(() => undefined),
      close: async () => {
        await new Promise((resolve) => setTimeout(resolve, 35));
        events.push('late-closed');
      },
      on: () => undefined,
    });
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
    if (attempt === 1) {
      return new Promise<PdfBrowser>((resolve) => {
        releaseFirst = resolve;
      });
    }
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
    releaseFirst?.({
      newContext: () => new Promise(() => undefined),
      close: async () => {
        await new Promise((resolve) => setTimeout(resolve, 35));
        events.push('late-timeout-closed');
      },
      on: () => undefined,
    });
  }, 10);
  for (let i = 0; i < 40 && !renderer.isAvailable(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(events).toEqual(['launch-1', 'late-timeout-closed', 'launch-2']);
  await renderer.close();
});

it('aborts wait during retirement cleanly and still schedules relaunch after retirement', async () => {
  let releaseKill: (() => void) | undefined;
  const spy = delayedLaunchFactory(async (attempt) => {
    if (attempt === 1) {
      return {
        newContext: () => new Promise(() => undefined),
        close: () => new Promise<void>(() => undefined),
        kill: () => new Promise<void>((r) => (releaseKill = r)),
        on: () => undefined,
      };
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
  for (let i = 0; i < 40 && !renderer.isAvailable(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(spy.launches()).toBe(2);
  expect(renderer.isAvailable()).toBe(true);
  await renderer.close();
});

it('reports unconfirmed retirement and keeps replacement gated until close finishes without kill', async () => {
  let releaseClose: (() => void) | undefined;
  const errors: unknown[] = [];
  const spy = delayedLaunchFactory(async (attempt) => {
    if (attempt === 1) {
      return {
        newContext: () => new Promise(() => undefined),
        close: () => new Promise<void>((r) => (releaseClose = r)),
        on: () => undefined,
      };
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
  for (let i = 0; i < 40 && !renderer.isAvailable(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(spy.launches()).toBe(2);
  expect(renderer.isAvailable()).toBe(true);
  await renderer.close();
});
