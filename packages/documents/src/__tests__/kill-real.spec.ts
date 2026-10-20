import { expect, it } from 'vitest';

import { playwrightFactory } from '../playwright/factory.ts';
import { realChromiumUnavailable } from './chromium-gate.ts';

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
  browser.kill?.();
  await expect(gone).resolves.toBeUndefined();
});
