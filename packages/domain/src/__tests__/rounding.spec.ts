import { describe, expect, it } from 'vitest';

import { MONEY_MAX } from '../money.js';
import { roundKwd } from '../rounding.js';

describe('roundKwd — half away from zero (ADR-0005)', () => {
  it.each([
    [10_004n, 10n, 1_000n],
    [10_005n, 10n, 1_001n],
    [10_006n, 10n, 1_001n],
    [-10_004n, 10n, -1_000n],
    [-10_005n, 10n, -1_001n],
    [-10_006n, 10n, -1_001n],
    [5n, 10n, 1n],
    [-5n, 10n, -1n],
    [4n, 10n, 0n],
    [-4n, 10n, 0n],
    [0n, 7n, 0n],
    [1_000n, 1n, 1_000n],
    [-1_000n, 1n, -1_000n],
  ])('%s / %s rounds to %s mills', (numerator, denominator, expected) => {
    expect(roundKwd(numerator, denominator)).toBe(expected);
  });

  it('rounds an odd denominator by comparing twice the remainder', () => {
    expect(roundKwd(1n, 3n)).toBe(0n);
    expect(roundKwd(2n, 3n)).toBe(1n);
    expect(roundKwd(-2n, 3n)).toBe(-1n);
  });

  it('makes a return the exact mirror of its sale', () => {
    for (let numerator = 0n; numerator < 2_000n; numerator += 1n) {
      expect(roundKwd(-numerator, 1_000n)).toBe(-roundKwd(numerator, 1_000n));
    }
  });

  it('rejects a zero or negative denominator', () => {
    expect(() => roundKwd(1n, 0n)).toThrow(RangeError);
    expect(() => roundKwd(1n, -10n)).toThrow(RangeError);
  });

  it('rejects a rounded result numeric(14,3) cannot store', () => {
    expect(() => roundKwd(MONEY_MAX * 10n + 5n, 10n)).toThrow(RangeError);
  });
});
