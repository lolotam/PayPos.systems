import { describe, expect, it } from 'vitest';
import { discountFromPercent, lineNet, MONEY_MAX, moneyToString, parseMoney, sumMoney } from '../index.js';

describe('lineNet: nonnegative money in mills', () => {
  it.each([
    [0n, 0n, 0n],
    [1n, 0n, 1n],
    [1n, 1n, 0n],
    [25000n, 2500n, 22500n],
    [7125n, 713n, 6412n],
    [MONEY_MAX, 0n, MONEY_MAX],
    [MONEY_MAX, 1n, 99_999_999_999_998n],
    [MONEY_MAX, MONEY_MAX, 0n],
  ])('%s less %s is %s', (price, discount, expected) => {
    expect(lineNet(price, discount)).toBe(expected);
  });

  it.each([
    [-1n, 0n], [0n, -1n], [0n, 1n], [1000n, 1001n], [-1n, -1n],
    [MONEY_MAX + 1n, 0n], [MONEY_MAX, MONEY_MAX + 1n],
    [-MONEY_MAX - 1n, 0n], [0n, -MONEY_MAX - 1n],
  ])('rejects invalid amounts %s/%s', (price, discount) => {
    expect(() => lineNet(price, discount)).toThrow(RangeError);
  });

  it.each([0, 1.25, NaN, Infinity, '0.000', null, undefined])('rejects non-bigint %s in either slot', (value) => {
    const invalid = value as unknown as bigint;
    expect(() => lineNet(invalid, 0n)).toThrow(TypeError);
    expect(() => lineNet(1000n, invalid)).toThrow(TypeError);
  });
});

describe('discountFromPercent: integer bps, half-up at line level', () => {
  it.each([
    [0n, 0, 0n], [0n, 10000, 0n],
    [1n, 4999, 0n], [1n, 5000, 1n], [1n, 5001, 1n],
    [7124n, 1000, 712n], [7125n, 1000, 713n], [7126n, 1000, 713n],
    [25000n, 0, 0n], [25000n, 10000, 25000n],
    [MONEY_MAX, 1, 10_000_000_000n],
    [MONEY_MAX, 1000, 10_000_000_000_000n],
    [MONEY_MAX, 9999, 99_989_999_999_999n],
    [MONEY_MAX, 10000, MONEY_MAX],
  ])('%s at %s bps gives %s mills', (price, bps, expected) => {
    expect(discountFromPercent(price, bps)).toBe(expected);
  });

  it('covers every allowed bps for zero and one mill', () => {
    for (let bps = 0; bps <= 10000; bps++) {
      expect(discountFromPercent(0n, bps)).toBe(0n);
      expect(discountFromPercent(1n, bps)).toBe(bps < 5000 ? 0n : 1n);
    }
  });

  it.each([-1, 10001, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER])('rejects invalid bps %s', (bps) => {
    expect(() => discountFromPercent(1000n, bps)).toThrow(RangeError);
    expect(() => discountFromPercent(0n, bps)).toThrow(RangeError);
  });

  it.each(['1000', 1000n, null, undefined])('rejects non-number bps %s without coercion', (value) => {
    expect(() => discountFromPercent(1000n, value as unknown as number)).toThrow(RangeError);
  });

  it.each([-1n, MONEY_MAX + 1n, -MONEY_MAX - 1n])('rejects invalid price %s even at zero percent', (price) => {
    expect(() => discountFromPercent(price, 0)).toThrow(RangeError);
  });

  it.each([0, '0.000', null, undefined])('rejects non-bigint price %s', (value) => {
    expect(() => discountFromPercent(value as unknown as bigint, 0)).toThrow(TypeError);
  });
});

it('composes lossless money transport and totals from independently rounded lines', () => {
  const price = parseMoney('7.125');
  const discount = discountFromPercent(price, 1000);
  expect(moneyToString(discount)).toBe('0.713');
  expect(moneyToString(lineNet(price, discount))).toBe('6.412');
  expect(sumMoney([lineNet(price, discount), lineNet(25000n, 2500n)])).toBe(28912n);
  expect(sumMoney([lineNet(1n, discountFromPercent(1n, 5000)), lineNet(1n, discountFromPercent(1n, 5000))])).toBe(0n);
  expect(sumMoney([lineNet(MONEY_MAX, 0n), lineNet(0n, 0n)])).toBe(MONEY_MAX);
  expect(() => sumMoney([lineNet(MONEY_MAX, 0n), lineNet(1n, 0n)])).toThrow(RangeError);
});
