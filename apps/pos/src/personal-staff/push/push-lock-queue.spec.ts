import { afterEach, expect, it } from 'vitest';

import { runPushExclusive } from './push-lock';

// القفل الأصلي بتاع البيئة؛ بنرجّعه بعد كل اختبار عشان الاختبارات التانية تشتغل على القفل الحقيقي.
const locksDescriptor = Object.getOwnPropertyDescriptor(globalThis.navigator, 'locks');

afterEach(() => {
  if (locksDescriptor !== undefined) {
    Object.defineProperty(globalThis.navigator, 'locks', locksDescriptor);
  }
});

function withoutLocks(): void {
  Object.defineProperty(globalThis.navigator, 'locks', { value: undefined, configurable: true });
}

it('runs the work one at a time when the browser has no locks', async () => {
  withoutLocks();
  const order: string[] = [];

  const first = runPushExclusive(async () => {
    order.push('first-start');
    await new Promise((resolve) => setTimeout(resolve, 5));
    order.push('first-end');
    return 'first';
  });
  const second = runPushExclusive(async () => {
    order.push('second-start');
    return 'second';
  });

  await expect(first).resolves.toBe('first');
  await expect(second).resolves.toBe('second');
  expect(order).toEqual(['first-start', 'first-end', 'second-start']);
});

it('keeps the queue going after a failure', async () => {
  withoutLocks();

  await expect(
    runPushExclusive(async () => {
      throw new Error('SYNTHETIC_FAILURE');
    }),
  ).rejects.toThrow('SYNTHETIC_FAILURE');
  await expect(runPushExclusive(async () => 'after')).resolves.toBe('after');
});
