import { expect, it } from 'vitest';

import { PlaywrightDocumentRenderer } from '../playwright/renderer.ts';
import { dropRetiredBrowser } from '../playwright/retire.ts';

it('returns unconfirmed within the kill grace when browser.kill never settles', async () => {
  let kills = 0;
  const startedAt = Date.now();
  const outcome = await dropRetiredBrowser(
    {
      newContext: () => new Promise(() => undefined),
      close: () => new Promise(() => undefined),
      kill: () => {
        kills += 1;
        return new Promise(() => undefined);
      },
      on: () => undefined,
    },
    20,
    (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  );
  expect(kills).toBe(1);
  expect(outcome.confirmed).toBe(false);
  expect(Date.now() - startedAt).toBeLessThan(1_500);
});

it('waits past the 500 ms kill grace until process exit is confirmed before relaunching', async () => {
  let launches = 0;
  let releaseKill: (() => void) | undefined;
  const renderer = new PlaywrightDocumentRenderer({
    factory: {
      launch: async () => {
        launches += 1;
        if (launches > 1) {
          return {
            newContext: () => new Promise(() => undefined),
            close: async () => undefined,
            on: () => undefined,
          };
        }
        return {
          newContext: () => new Promise(() => undefined),
          close: () => new Promise(() => undefined),
          kill: () =>
            new Promise<void>((resolve) => {
              releaseKill = resolve;
            }),
          on: () => undefined,
        };
      },
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    backoffMs: [0],
    overallTimeoutMs: 20,
    browserCloseGraceMs: 10,
  });
  await renderer.start();
  await expect(renderer.render('<p>x</p>')).rejects.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 580));
  expect(releaseKill).toBeDefined();
  expect(launches).toBe(1);
  releaseKill?.();
  for (let i = 0; i < 20 && launches < 2; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(launches).toBe(2);
  await renderer.close();
});
