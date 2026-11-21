import { expect, it } from 'vitest';
import { ownRatingSummary, ownRatingSummaryQuery } from './own-rating-summary.js';

it('parses both variants and rejects a mismatched average/count pair', () => {
  expect(ownRatingSummary.parse({ visibility: 'HIDDEN' })).toEqual({ visibility: 'HIDDEN' });
  expect(ownRatingSummary.parse({ visibility: 'VISIBLE', average: '4.5', count: 2 })).toEqual({
    visibility: 'VISIBLE',
    average: '4.5',
    count: 2,
  });
  expect(ownRatingSummary.parse({ visibility: 'VISIBLE', average: null, count: 0 })).toEqual({
    visibility: 'VISIBLE',
    average: null,
    count: 0,
  });
  expect(
    ownRatingSummary.safeParse({ visibility: 'VISIBLE', average: null, count: 1 }).success,
  ).toBe(false);
  expect(
    ownRatingSummary.safeParse({ visibility: 'VISIBLE', average: '4.5', count: 0 }).success,
  ).toBe(false);
});

it('refuses any query key, including every subject key', () => {
  expect(ownRatingSummaryQuery.safeParse({}).success).toBe(true);
  expect(ownRatingSummaryQuery.safeParse({ x: '1' }).success).toBe(false);
  expect(
    ownRatingSummaryQuery.safeParse({ employee_id: '018f0000-0000-7000-8000-000000000001' })
      .success,
  ).toBe(false);
  expect(ownRatingSummaryQuery.safeParse({ branch_id: 'b' }).success).toBe(false);
  expect(ownRatingSummaryQuery.safeParse({ business_id: 'b' }).success).toBe(false);
  expect(ownRatingSummaryQuery.safeParse({ company_id: 'c' }).success).toBe(false);
});

it.each(['1.0', '4.9', '5.0', '3.7'])('accepts the one-decimal average %s', (average) => {
  expect(ownRatingSummary.safeParse({ visibility: 'VISIBLE', average, count: 1 }).success).toBe(
    true,
  );
});

it.each(['4', '4.50', '4.55', '5.1', '0.0', '6.0', '-1.0', '04.5'])(
  'rejects the noncanonical average %s',
  (average) => {
    expect(ownRatingSummary.safeParse({ visibility: 'VISIBLE', average, count: 1 }).success).toBe(
      false,
    );
  },
);

it('refuses extra keys on either variant, so no comment, customer or star list can pass', () => {
  expect(
    ownRatingSummary.safeParse({ visibility: 'HIDDEN', average: '4.5', count: 2 }).success,
  ).toBe(false);
  expect(
    ownRatingSummary.safeParse({
      visibility: 'VISIBLE',
      average: '4.5',
      count: 2,
      comment: 'حلو',
    }).success,
  ).toBe(false);
  expect(
    ownRatingSummary.safeParse({
      visibility: 'VISIBLE',
      average: '4.5',
      count: 2,
      stars: [4, 5],
    }).success,
  ).toBe(false);
  expect(
    ownRatingSummary.safeParse({
      visibility: 'VISIBLE',
      average: '4.5',
      count: 2,
      employee_id: '018f0000-0000-7000-8000-000000000001',
    }).success,
  ).toBe(false);
});

it('refuses a non-integer or negative count', () => {
  expect(
    ownRatingSummary.safeParse({ visibility: 'VISIBLE', average: '4.5', count: -1 }).success,
  ).toBe(false);
  expect(
    ownRatingSummary.safeParse({ visibility: 'VISIBLE', average: '4.5', count: 1.5 }).success,
  ).toBe(false);
});
