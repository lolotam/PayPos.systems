import { MONEY_MAX } from '@pospay/domain';
import { describe, expect, it } from 'vitest';

import { roundCashPayable } from '../cash-payable.ts';

describe('roundCashPayable', () => {
  it.each([
    ['zero stays zero', 0n, 0n],
    ['one mill goes down', 1n, 0n],
    ['two mills go down', 2n, 0n],
    ['three mills go up', 3n, 5n],
    ['four mills go up', 4n, 5n],
    ['an already-rounded 5 stays', 5n, 5n],
    ['the owner example 41.003 becomes 41.005', 41_003n, 41_005n],
    ['41.002 becomes 41.000', 41_002n, 41_000n],
    ['41.008 becomes 41.010', 41_008n, 41_010n],
    ['an already-rounded KWD figure stays', 123_450n, 123_450n],
  ])('%s', (_name, mills, rounded) => {
    expect(roundCashPayable(mills)).toBe(rounded);
  });

  it('is the nearest multiple of 5 mills for every residue, with ties (2.5 mills) rounding half up', () => {
    // الفرق عن الدقيق دايماً أقل من أو يساوي 2 فلس، وأي مدخل صحيح مش بيقع على نص المسافة بالظبط (2.5).
    for (let mills = 0n; mills <= 1_000n; mills += 1n) {
      const rounded = roundCashPayable(mills);
      expect(rounded % 5n).toBe(0n);
      const distance = rounded > mills ? rounded - mills : mills - rounded;
      expect(distance <= 2n).toBe(true);
      const alternative = rounded > mills ? rounded - 5n : rounded + 5n;
      const alternativeDistance = alternative > mills ? alternative - mills : mills - alternative;
      expect(distance < alternativeDistance).toBe(true);
    }
  });

  it('rounds each employee on her own: the sum of rounded figures is not the rounded sum', () => {
    const employees = [1n, 1n, 1n, 1n, 1n];
    const roundedSum = employees.map(roundCashPayable).reduce((total, value) => total + value, 0n);
    expect(roundedSum).toBe(0n);
    expect(roundCashPayable(employees.reduce((total, value) => total + value, 0n))).toBe(5n);
  });

  it('refuses a negative payable and a result outside numeric(14,3)', () => {
    expect(() => roundCashPayable(-1n)).toThrow(RangeError);
    expect(() => roundCashPayable(MONEY_MAX)).toThrow(RangeError);
    expect(() => roundCashPayable(MONEY_MAX - 1n)).toThrow(RangeError);
    expect(roundCashPayable(MONEY_MAX - 4n)).toBe(MONEY_MAX - 4n);
  });
});
