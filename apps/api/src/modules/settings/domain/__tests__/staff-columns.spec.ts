import { staffColumnCode } from '@pospay/contracts';
import { describe, expect, it } from 'vitest';

import {
  STAFF_COLUMN_CODES,
  DEFAULT_STAFF_COLUMNS,
  canonicalStaffColumns,
  effectiveStaffColumns,
  effectiveStaffMonthsBack,
  invalidStaffColumns,
  isValidStaffMonthsBack,
  sameStaffColumns,
} from '../staff-columns.ts';

describe('staff columns (spec 060 D-A6, D-A7)', () => {
  it('D-A7 the domain codes are the contract enum, in the same order', () => {
    expect([...staffColumnCode.options]).toEqual(STAFF_COLUMN_CODES);
  });

  it('MY-17 nothing saved: her work and her money, without list_price, discount, net or rating_average', () => {
    expect(effectiveStaffColumns(null)).toEqual([
      'date',
      'time',
      'service',
      'customer_name',
      'share',
      'estimated_commission',
      'tip',
    ]);
    expect(DEFAULT_STAFF_COLUMNS).toContain('rating_average');
  });

  it('MY-18 a saved set is returned in enum order', () => {
    expect(effectiveStaffColumns(['net', 'date', 'list_price'])).toEqual([
      'date',
      'list_price',
      'net',
    ]);
    expect(effectiveStaffColumns([])).toEqual([]);
  });

  it('MY-20 estimated_commission is an ordinary column', () => {
    expect(invalidStaffColumns(['date', 'service'])).toEqual([]);
    expect(effectiveStaffColumns(['date', 'service'])).not.toContain('estimated_commission');
  });

  it('MY-19 refuses unknown, duplicate, rating_comments, customer_phone and the postponed rating_average', () => {
    expect(
      invalidStaffColumns([
        'date',
        'bogus',
        'date',
        'rating_comments',
        'customer_phone',
        'rating_average',
        'bogus',
      ]),
    ).toEqual(['bogus', 'date', 'rating_comments', 'customer_phone', 'rating_average']);
  });

  it('FR-A08 rating_average never reaches a consumer, even from a stored set', () => {
    expect(effectiveStaffColumns(['rating_average', 'tip'])).toEqual(['tip']);
  });

  it('MY-13 months back: unset is 2, saved values from 1 to 12 pass, 0, 13 and fractions do not', () => {
    expect(effectiveStaffMonthsBack(null)).toBe(2);
    expect(effectiveStaffMonthsBack(3)).toBe(3);
    expect(effectiveStaffMonthsBack(12)).toBe(12);
    expect(effectiveStaffMonthsBack(13)).toBe(12);
    expect(effectiveStaffMonthsBack(24)).toBe(12);
    for (const valid of [1, 2, 3, 12]) expect(isValidStaffMonthsBack(valid)).toBe(true);
    for (const invalid of [0, 13, 24, 25, -1, 1.5])
      expect(isValidStaffMonthsBack(invalid)).toBe(false);
  });
});

describe('the staff columns set: one order, one change (spec 060 MY-18)', () => {
  it('canonicalStaffColumns returns the codes in enum order, each once', () => {
    expect(canonicalStaffColumns(['tip', 'date'])).toEqual(['date', 'tip']);
    expect(canonicalStaffColumns(['tip', 'date', 'tip'])).toEqual(['date', 'tip']);
    expect(canonicalStaffColumns([])).toEqual([]);
  });

  it('sameStaffColumns compares the set, not the order', () => {
    expect(sameStaffColumns(['tip', 'date'], ['date', 'tip'])).toBe(true);
    expect(sameStaffColumns(['date'], ['date', 'tip'])).toBe(false);
    expect(sameStaffColumns(null, null)).toBe(true);
    expect(sameStaffColumns(null, [])).toBe(false);
    expect(sameStaffColumns([], null)).toBe(false);
  });
});
