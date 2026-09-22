import { describe, expect, it } from 'vitest';

import { MONEY_MAX } from '../money.js';
import {
  PERCENTAGE_SCALE,
  applyPercentage,
  assertPercentage,
  parsePercentage,
  percentageToString,
} from '../percentage.js';

describe('parsePercentage', () => {
  it.each([
    ['0', 0n],
    ['5', 50_000n],
    ['12.5', 125_000n],
    ['0.1250', 1_250n],
    ['0.0001', 1n],
    ['100', PERCENTAGE_SCALE],
    ['150', 1_500_000n],
  ])('parses %s%% as %s units', (text, units) => {
    expect(parsePercentage(text)).toBe(units);
  });

  it.each(['', '-5', '+5', '5%', '5.', '.5', '0.00001', '5 ', '1e2'])(
    'rejects %j instead of guessing',
    (text) => {
      expect(() => parsePercentage(text)).toThrow(TypeError);
    },
  );
});

describe('percentageToString', () => {
  it.each([
    [0n, '0.0000'],
    [1n, '0.0001'],
    [125_000n, '12.5000'],
    [PERCENTAGE_SCALE, '100.0000'],
  ])('formats %s units as %s', (units, text) => {
    expect(percentageToString(units)).toBe(text);
  });

  it('round-trips through parsePercentage', () => {
    for (const units of [0n, 1n, 9_999n, 10_000n, 123_456n, 1_500_000n]) {
      expect(parsePercentage(percentageToString(units))).toBe(units);
    }
  });
});

describe('assertPercentage', () => {
  it('rejects a negative rate', () => {
    expect(() => assertPercentage(-1n)).toThrow(RangeError);
  });

  it('rejects a number that slipped past the type checker', () => {
    const fromJson = JSON.parse('5') as bigint;
    expect(() => assertPercentage(fromJson)).toThrow(TypeError);
  });
});

describe('applyPercentage', () => {
  it("matches the owner's worked example: 5% of 500 KWD is 25 KWD", () => {
    expect(applyPercentage(500_000n, parsePercentage('5'))).toBe(25_000n);
  });

  it.each([
    [1_000n, '12.5', 125n],
    [1_001n, '12.5', 125n],
    [1_004n, '12.5', 126n],
    [333n, '33.3333', 111n],
    [10n, '5', 1n],
    [9n, '5', 0n],
    [12_345n, '0', 0n],
    [0n, '15', 0n],
    [2_000n, '150', 3_000n],
  ])('%s mills at %s%% rounds half-up to %s mills', (amount, rate, expected) => {
    expect(applyPercentage(amount, parsePercentage(rate))).toBe(expected);
  });

  it('gives a return the exact negative of the sale', () => {
    const rate = parsePercentage('12.5');
    for (let amount = 0n; amount < 500n; amount += 1n) {
      expect(applyPercentage(-amount, rate)).toBe(-applyPercentage(amount, rate));
    }
  });

  it('stays exact at the numeric(14,3) bound', () => {
    expect(applyPercentage(MONEY_MAX, PERCENTAGE_SCALE)).toBe(MONEY_MAX);
  });

  it('rejects a negative rate', () => {
    expect(() => applyPercentage(1_000n, -1n)).toThrow(RangeError);
  });
});
