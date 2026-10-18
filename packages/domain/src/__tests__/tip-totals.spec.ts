import { describe, expect, it } from 'vitest';

import { MONEY_MAX } from '../money.js';
import { sumTipTotalsByMethod } from '../tip-totals.js';

describe('sumTipTotalsByMethod', () => {
  it('returns canonical zeros for an empty set', () => {
    expect(sumTipTotalsByMethod([])).toEqual({ total_cash: '0.000', total_card: '0.000' });
  });

  it('sums cash alone and leaves card at zero', () => {
    expect(sumTipTotalsByMethod([
      { method: 'CASH', amount: 1_500n },
      { method: 'CASH', amount: 3_000n },
    ])).toEqual({ total_cash: '4.500', total_card: '0.000' });
  });

  it('sums card alone and leaves cash at zero', () => {
    expect(sumTipTotalsByMethod([{ method: 'CARD', amount: 2_250n }])).toEqual({
      total_cash: '0.000',
      total_card: '2.250',
    });
  });

  it('sums both methods from the same entries', () => {
    expect(sumTipTotalsByMethod([
      { method: 'CARD', amount: 2_250n },
      { method: 'CASH', amount: 1_500n },
      { method: 'CASH', amount: 3_000n },
    ])).toEqual({ total_cash: '4.500', total_card: '2.250' });
  });

  it('accepts a method total at the numeric bound and rejects one mill past it', () => {
    expect(sumTipTotalsByMethod([{ method: 'CASH', amount: MONEY_MAX }])).toEqual({
      total_cash: '99999999999.999',
      total_card: '0.000',
    });
    expect(sumTipTotalsByMethod([
      { method: 'CARD', amount: MONEY_MAX - 1n },
      { method: 'CARD', amount: 1n },
    ])).toEqual({ total_cash: '0.000', total_card: '99999999999.999' });
    expect(() => sumTipTotalsByMethod([
      { method: 'CASH', amount: MONEY_MAX },
      { method: 'CASH', amount: 1n },
    ])).toThrow(RangeError);
    expect(() => sumTipTotalsByMethod([{ method: 'CARD', amount: MONEY_MAX + 1n }])).toThrow(RangeError);
  });
});
