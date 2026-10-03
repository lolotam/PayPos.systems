import { MONEY_MAX } from '@pospay/domain';
import { expect, it } from 'vitest';
import {
  effectiveDiscountBps,
  isWithinLimit,
  validateDiscountLimitBps,
} from '../discount-limit.ts';

it('accepts every integer in the permitted range', () => {
  for (let bps = 0; bps <= 10000; bps++) expect(validateDiscountLimitBps(bps)).toBe(bps);
});
it.each([-1, 10001, 0.1, NaN, Infinity, -Infinity])(
  'refuses invalid bps %s in validation and comparison',
  (value) => {
    expect(() => validateDiscountLimitBps(value)).toThrow(RangeError);
    expect(() => isWithinLimit(value, 10000)).toThrow(RangeError);
    expect(() => isWithinLimit(0, value)).toThrow(RangeError);
  },
);
it.each([
  [0n, 0n, 0],
  [0n, 500n, 0],
  [10000n, 10000n, 0],
  [10000n, 12000n, 0],
  [10000n, 8766n, 1234],
  [10000n, 0n, 10000],
  [3n, 2n, 3334],
  [20001n, 20000n, 1],
  [20000n, 19999n, 1],
  [19999n, 19998n, 1],
  [MONEY_MAX, MONEY_MAX - 1n, 1],
  [MONEY_MAX, 0n, 10000],
])('computes %s → %s as %i bps without losing mills', (list, net, expected) => {
  expect(effectiveDiscountBps(list, net)).toBe(expected);
});
it('never rounds an over-limit rational down or rounds an exact ratio up', () => {
  for (let list = 1n; list <= 100n; list++) {
    for (let net = 0n; net <= list; net++) {
      const bps = BigInt(effectiveDiscountBps(list, net));
      const exact = (list - net) * 10000n;
      expect(bps * list).toBeGreaterThanOrEqual(exact);
      expect((bps - 1n) * list).toBeLessThan(exact);
    }
  }
});
it.each([
  [-1n, 0n],
  [1n, -1n],
  [MONEY_MAX + 1n, 0n],
  [1n, MONEY_MAX + 1n],
])('rejects invalid money %s/%s', (list, net) => {
  expect(() => effectiveDiscountBps(list, net)).toThrow(RangeError);
});
it('includes the limit and both boundaries; rejects one bps above it', () => {
  expect(isWithinLimit(0, 0)).toBe(true);
  expect(isWithinLimit(10000, 10000)).toBe(true);
  expect(isWithinLimit(500, 500)).toBe(true);
  expect(isWithinLimit(501, 500)).toBe(false);
  expect(isWithinLimit(1, 0)).toBe(false);
});
