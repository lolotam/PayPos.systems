import { expect, it } from 'vitest';
import { MONEY_MAX } from '../money.js';
import { sumMonthlyTipTotalsByMethod } from '../monthly-tip-totals.js';

it.each(['CASH', 'CARD'] as const)(
  'sums two valid large visits for %s without a monthly storage cap',
  (method) => {
    const totals = sumMonthlyTipTotalsByMethod([
      { method, amount: 50_000_000_000_000n },
      { method, amount: 50_000_000_000_000n },
    ]);
    expect(totals).toEqual(
      method === 'CASH'
        ? { total_cash: '100000000000.000', total_card: '0.000' }
        : { total_cash: '0.000', total_card: '100000000000.000' },
    );
  },
);
it('preserves fractions, carry and independent methods', () => {
  expect(
    sumMonthlyTipTotalsByMethod([
      { method: 'CASH', amount: 999n },
      { method: 'CASH', amount: 2n },
      { method: 'CARD', amount: MONEY_MAX },
      { method: 'CARD', amount: 1n },
    ]),
  ).toEqual({ total_cash: '1.001', total_card: '100000000000.000' });
  expect(sumMonthlyTipTotalsByMethod([])).toEqual({ total_cash: '0.000', total_card: '0.000' });
});
it.each([MONEY_MAX + 1n, -MONEY_MAX - 1n, -1n])(
  'refuses invalid per-visit tip entry %s',
  (amount) => {
    expect(() => sumMonthlyTipTotalsByMethod([{ method: 'CASH', amount }])).toThrow(RangeError);
  },
);
