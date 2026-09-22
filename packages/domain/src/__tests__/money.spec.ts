import { describe, expect, it } from 'vitest';

import {
  MONEY_MAX,
  MONEY_MIN,
  assertMoney,
  moneyToString,
  parseMoney,
  sumMoney,
} from '../money.js';

describe('parseMoney', () => {
  it.each([
    ['0', 0n],
    ['12', 12_000n],
    ['12.5', 12_500n],
    ['12.50', 12_500n],
    ['12.500', 12_500n],
    ['0.001', 1n],
    ['-0.125', -125n],
    ['-0', 0n],
    ['99999999999.999', MONEY_MAX],
    ['-99999999999.999', MONEY_MIN],
  ])('parses %s as %s mills', (text, mills) => {
    expect(parseMoney(text)).toBe(mills);
  });

  it.each(['', ' 1', '1 ', '+1', '1.', '.5', '1.0001', '1e3', '1,000', 'abc', '--1', 'NaN'])(
    'rejects the malformed string %j instead of guessing',
    (text) => {
      expect(() => parseMoney(text)).toThrow(TypeError);
    },
  );

  it('rejects a value numeric(14,3) cannot store', () => {
    expect(() => parseMoney('100000000000.000')).toThrow(RangeError);
    expect(() => parseMoney('-100000000000')).toThrow(RangeError);
  });
});

describe('moneyToString', () => {
  it.each([
    [0n, '0.000'],
    [1n, '0.001'],
    [12_500n, '12.500'],
    [-125n, '-0.125'],
    [-1_000n, '-1.000'],
    [MONEY_MAX, '99999999999.999'],
    [MONEY_MIN, '-99999999999.999'],
  ])('formats %s mills as %s', (mills, text) => {
    expect(moneyToString(mills)).toBe(text);
  });

  it('round-trips losslessly through parseMoney', () => {
    for (const mills of [0n, 1n, -1n, 999n, 1_001n, -12_345n, MONEY_MAX, MONEY_MIN]) {
      expect(parseMoney(moneyToString(mills))).toBe(mills);
    }
  });

  it('refuses to serialise an out-of-range value', () => {
    expect(() => moneyToString(MONEY_MAX + 1n)).toThrow(RangeError);
  });
});

describe('assertMoney', () => {
  it('accepts both bounds', () => {
    expect(assertMoney(MONEY_MAX)).toBe(MONEY_MAX);
    expect(assertMoney(MONEY_MIN)).toBe(MONEY_MIN);
  });

  it('rejects one mill past either bound', () => {
    expect(() => assertMoney(MONEY_MAX + 1n)).toThrow(RangeError);
    expect(() => assertMoney(MONEY_MIN - 1n)).toThrow(RangeError);
  });

  it('rejects a number that slipped past the type checker', () => {
    const fromJson = JSON.parse('12.5') as bigint;
    expect(() => assertMoney(fromJson)).toThrow(TypeError);
  });
});

describe('sumMoney', () => {
  it('returns zero for no lines', () => {
    expect(sumMoney([])).toBe(0n);
  });

  it('sums signed lines exactly', () => {
    expect(sumMoney([1_250n, 3_333n, -500n])).toBe(4_083n);
  });

  it('rejects a total numeric(14,3) cannot store', () => {
    expect(() => sumMoney([MONEY_MAX, 1n])).toThrow(RangeError);
  });

  it('rejects an out-of-range line even when the total would fit', () => {
    expect(() => sumMoney([MONEY_MAX + 1n, -1n])).toThrow(RangeError);
  });
});
