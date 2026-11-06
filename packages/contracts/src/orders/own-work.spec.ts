import { expect, it } from 'vitest';
import { ownServiceLine, ownServiceLinesQuery } from './own-service-lines.js';
import { ownTips } from './own-tips.js';

const context = {
  line_id: '01923344-5566-7000-8000-000000000001',
  branch_name_ar: null,
  branch_name_en: 'Synthetic branch',
  cancelled: false,
};
it.each([
  'customer_phone',
  'customer_phone_masked',
  'customer_id',
  'employee_id',
  'recorded_by',
  'rating_average',
  'rating_comments',
  'comment',
  'colleague_name',
])('refuses sensitive non-column key %s', (key) => {
  expect(ownServiceLine.safeParse({ ...context, [key]: 'private' }).success).toBe(false);
});
it('preserves absent hidden columns and integer own share', () => {
  expect(ownServiceLine.parse(context)).toEqual(context);
  expect(ownServiceLine.parse({ ...context, share_bps: 7000 })).toMatchObject({ share_bps: 7000 });
  expect(ownServiceLine.safeParse({ ...context, share_bps: 0.7 }).success).toBe(false);
});
it('hidden tips cannot carry an amount or extra keys', () => {
  const hidden = { month: '2026-10', status: 'HIDDEN' };
  expect(ownTips.parse(hidden)).toEqual(hidden);
  expect(ownTips.safeParse({ ...hidden, total_cash: '0.000' }).success).toBe(false);
  expect(
    ownTips.parse({ ...hidden, status: 'VISIBLE', total_cash: '1.500', total_card: '0.000' }),
  ).toMatchObject({ total_cash: '1.500', total_card: '0.000' });
});
it('cursor accepts a line id only, without a date/time tuple', () => {
  expect(ownServiceLinesQuery.parse({ cursor: context.line_id }).cursor).toBe(context.line_id);
  expect(ownServiceLinesQuery.safeParse({ cursor: '2026-10-01|12:00|id' }).success).toBe(false);
});
