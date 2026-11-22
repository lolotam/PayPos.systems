import { expect, it } from 'vitest';
import { ownServiceLine, ownServiceLines, ownServiceLinesQuery } from './own-service-lines.js';

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

it('preserves absent hidden columns and the integer own share', () => {
  expect(ownServiceLine.parse(context)).toEqual(context);
  expect(ownServiceLine.parse({ ...context, share_bps: 7000 })).toMatchObject({ share_bps: 7000 });
  expect(ownServiceLine.safeParse({ ...context, share_bps: 0.7 }).success).toBe(false);
});

it('wraps lines in a month page with a cursor and refuses extra keys', () => {
  const body = {
    month: '2026-10',
    time_zone: 'Asia/Kuwait',
    items: [context],
    next_cursor: null,
  };
  expect(ownServiceLines.parse(body)).toEqual(body);
  expect(ownServiceLines.safeParse({ ...body, total: 1 }).success).toBe(false);
});

it('requires the business time zone as an IANA name, never an offset', () => {
  const body = { month: '2026-10', items: [], next_cursor: null };
  expect(ownServiceLines.safeParse(body).success).toBe(false);
  expect(ownServiceLines.safeParse({ ...body, time_zone: '+03:00' }).success).toBe(false);
  expect(ownServiceLines.safeParse({ ...body, time_zone: 'Asia/Kuwait' }).success).toBe(true);
});

it('cursor accepts a line id only, without a date/time tuple', () => {
  expect(ownServiceLinesQuery.parse({ cursor: context.line_id }).cursor).toBe(context.line_id);
  expect(ownServiceLinesQuery.safeParse({ cursor: '2026-10-01|12:00|id' }).success).toBe(false);
  expect(ownServiceLinesQuery.safeParse({ employee_id: context.line_id }).success).toBe(false);
});
