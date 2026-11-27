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
