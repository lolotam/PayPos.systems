import { expect, it } from 'vitest';
import { ownTips } from './own-tips.js';
import { ownWorkMonth } from './own-work-month.js';
import { monthlyTipTotal } from './monthly-tip-total.js';

it('accepts exact monthly totals beyond the per-visit storage bound for both methods', () => {
  expect(
    ownTips.parse({
      month: '2026-10',
      status: 'VISIBLE',
      total_cash: '100000000000.000',
      total_card: '100000000000.001',
    }),
  ).toMatchObject({
    total_cash: '100000000000.000',
    total_card: '100000000000.001',
  });
  expect(
    ownTips.safeParse({ month: '2026-10', status: 'HIDDEN', total_cash: '100000000000.000' })
      .success,
  ).toBe(false);
});
it.each(['-1.000', '1e3', '01.000', '00.000', '1.00', '1.0000', '.001', '1', '+1.000', ' 1.000'])(
  'rejects noncanonical monthly total %s',
  (value) => {
    expect(monthlyTipTotal.safeParse(value).success).toBe(false);
  },
);

it('hidden tips cannot carry an amount or extra keys', () => {
  const hidden = { month: '2026-10', status: 'HIDDEN' };
  expect(ownTips.parse(hidden)).toEqual(hidden);
  expect(ownTips.safeParse({ ...hidden, total_cash: '0.000' }).success).toBe(false);
  expect(
    ownTips.parse({ ...hidden, status: 'VISIBLE', total_cash: '1.500', total_card: '0.000' }),
  ).toMatchObject({ total_cash: '1.500', total_card: '0.000' });
});

it.each(['0000-01', '2026-00', '2026-13', '2026-1', '2026-01x'])(
  'rejects invalid month %s',
  (month) => {
    expect(ownWorkMonth.safeParse(month).success).toBe(false);
  },
);
it.each(['1000-01', '2026-12', '9999-12'])('preserves month language %s', (month) => {
  expect(ownWorkMonth.parse(month)).toBe(month);
});
