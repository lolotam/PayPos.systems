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

  it('MY-17 nothing saved: her work, her money and her rating average, without list_price, discount or net', () => {
    expect(effectiveStaffColumns(null)).toEqual([
      'date',
      'time',
      'service',
      'customer_name',
      'share',
      'estimated_commission',
      'tip',
      'rating_average',
    ]);
    expect(effectiveStaffColumns(null)).toEqual([...DEFAULT_STAFF_COLUMNS]);
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

  it('MY-19 refuses unknown, duplicate, rating_comments and customer_phone, and accepts rating_average', () => {
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
    ).toEqual(['bogus', 'date', 'rating_comments', 'customer_phone']);
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

describe('rating_average is an ordinary staff column (spec 060 D-A7, FR-A08)', () => {
  it('D-A7 rating_average is an ordinary column: a saved set may hold it, once', () => {
    expect(invalidStaffColumns(['rating_average'])).toEqual([]);
    expect(invalidStaffColumns(['tip', 'rating_average'])).toEqual([]);
    expect(invalidStaffColumns(['rating_average', 'rating_average'])).toEqual(['rating_average']);
    expect(canonicalStaffColumns(['rating_average', 'date'])).toEqual(['date', 'rating_average']);
  });

  it('FR-A08 rating_average reaches a consumer from a stored set, and is absent when the set leaves it out', () => {
    expect(effectiveStaffColumns(['rating_average', 'tip'])).toEqual(['tip', 'rating_average']);
    expect(effectiveStaffColumns(['tip'])).not.toContain('rating_average');
    expect(effectiveStaffColumns([])).toEqual([]);
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
