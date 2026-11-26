import { describe, expect, it } from 'vitest';

import {
  commissionMonthIndex,
  isCommissionCalendarDate,
  isCommissionPeriod,
  nextCommissionPeriod,
} from '../commission-calendar.ts';
import { CommissionPeriodInvalidError } from '../errors.ts';

describe('isCommissionCalendarDate', () => {
  it.each(['2024-02-29', '2026-02-28', '2026-01-31', '0001-01-01', '9999-12-31'])(
    'accepts the real calendar date %s',
    (value) => {
      expect(isCommissionCalendarDate(value)).toBe(true);
    },
  );

  it.each([
    '0000-01-01',
    '0000-02-29',
    '2026-02-29',
    '2026-00-01',
    '2026-13-01',
    '2026-01-00',
    '2026-01-32',
    '2026-02-30',
    '2026-04-31',
    '26-01-01',
    '2026-1-01',
    '2026-01-1',
    'not-a-date',
    '',
  ])('refuses the invalid calendar date %s', (value) => {
    expect(isCommissionCalendarDate(value)).toBe(false);
  });
});

describe('isCommissionPeriod', () => {
  it.each(['2026-01', '2026-12', '0001-01', '9999-12'])(
    'accepts the commission month %s',
    (value) => {
      expect(isCommissionPeriod(value)).toBe(true);
    },
  );

  it.each(['0000-01', '2026-00', '2026-13', '2026-1', '26-01', '2026-01-01', 'not-a-month', ''])(
    'refuses the invalid commission month %s',
    (value) => {
      expect(isCommissionPeriod(value)).toBe(false);
    },
  );
});

describe('commissionMonthIndex', () => {
  it('numbers the months from the year and the month so a difference needs no loop', () => {
    expect(commissionMonthIndex('2026-01')).toBe(2026 * 12 + 1);
    expect(commissionMonthIndex('2026-12')).toBe(2026 * 12 + 12);
    expect(commissionMonthIndex('0001-01')).toBe(13);
  });

  it('keeps the distance between two months a plain subtraction', () => {
    expect(commissionMonthIndex('2026-03') - commissionMonthIndex('2026-02')).toBe(1);
    expect(commissionMonthIndex('2027-01') - commissionMonthIndex('2026-12')).toBe(1);
    expect(commissionMonthIndex('2027-01') - commissionMonthIndex('2026-01')).toBe(12);
  });
});

describe('nextCommissionPeriod', () => {
  it.each([
    ['2026-01', '2026-02'],
    ['2026-11', '2026-12'],
    ['0001-01', '0001-02'],
  ])('carries the month %s to %s', (period, expected) => {
    expect(nextCommissionPeriod(period)).toBe(expected);
  });

  it('rolls December over into the next year', () => {
    expect(nextCommissionPeriod('2026-12')).toBe('2027-01');
  });

  it.each(['2026-13', '0000-01', '2026-1', 'not-a-month'])(
    'refuses the invalid commission month %s instead of looping for ever',
    (period) => {
      expect(() => nextCommissionPeriod(period)).toThrow(CommissionPeriodInvalidError);
      expect(() => nextCommissionPeriod(period)).toThrow(
        expect.objectContaining({ code: 'COMMISSION_PERIOD_INVALID' }),
      );
    },
  );
});
