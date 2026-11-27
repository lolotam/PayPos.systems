import { expect, it } from 'vitest';

import { dropRetiredBrowser } from '../playwright/retire.ts';

it('bounds waiting on browser.kill when a kill promise never settles', async () => {
  let kills = 0;
  const startedAt = Date.now();
  await dropRetiredBrowser(
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
  expect(Date.now() - startedAt).toBeLessThan(1_500);
});
