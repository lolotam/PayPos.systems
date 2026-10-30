import { describe, expect, it } from 'vitest';

import {
  assertCommissionPlanDateBeforeLocks,
  assertCommissionPlanEffectiveFrom,
  commissionPlanMonthsStillToLock,
  commissionPlanMonthsToLock,
  nextCommissionPlanVersion,
  type CommissionPlanStatementPeriod,
} from '../plan-periods.ts';

const locked = (period: string, status: CommissionPlanStatementPeriod['status']) => ({
  period,
  status,
  statementId: `statement-${period}`,
});

describe('commissionPlanMonthsToLock', () => {
  it('includes both month edges in ascending order', () => {
    expect(commissionPlanMonthsToLock('2026-09-30', '2026-11-01')).toEqual([
      '2026-09',
      '2026-10',
      '2026-11',
    ]);
  });

  it('crosses December into January without skipping a month', () => {
    expect(commissionPlanMonthsToLock('2026-12-01', '2027-01-31')).toEqual(['2026-12', '2027-01']);
  });

  it('returns the current month once and no months for a future version', () => {
    expect(commissionPlanMonthsToLock('2026-10-30', '2026-10-30')).toEqual(['2026-10']);
    expect(commissionPlanMonthsToLock('2026-11-01', '2026-10-30')).toEqual([]);
  });

  it('refuses malformed and year-zero months', () => {
    expect(() => commissionPlanMonthsToLock('2026-13-01', '2026-12-01')).toThrow(RangeError);
    expect(() => commissionPlanMonthsToLock('0000-01-01', '2026-01-01')).toThrow(RangeError);
  });
});

const input = {
  effectiveFrom: '2026-10-30',
  wholePeriod: false,
  today: '2026-10-30',
  locked: [locked('2026-10', 'DRAFT')],
};

describe('assertCommissionPlanEffectiveFrom effective date and own month', () => {
  it('accepts today itself and yesterday is the ordinary past boundary', () => {
    expect(assertCommissionPlanEffectiveFrom(input)).toEqual([]);
    expect(() =>
      assertCommissionPlanEffectiveFrom({ ...input, effectiveFrom: '2026-10-29' }),
    ).toThrowError(expect.objectContaining({ code: 'COMMISSION_EFFECTIVE_FROM_PAST' }));
  });

  it('accepts a DRAFT whole_period month and rejects its REVIEWED month', () => {
    const whole = { ...input, effectiveFrom: '2026-09-01', wholePeriod: true };
    expect(
      assertCommissionPlanEffectiveFrom({
        ...whole,
        locked: [locked('2026-09', 'DRAFT'), locked('2026-10', 'DRAFT')],
      }),
    ).toEqual([]);
    expect(() =>
      assertCommissionPlanEffectiveFrom({
        ...whole,
        locked: [locked('2026-09', 'REVIEWED'), locked('2026-10', 'DRAFT')],
      }),
    ).toThrowError(expect.objectContaining({ code: 'COMMISSION_PERIOD_NOT_DRAFT' }));
  });

  it.each([
    ['APPROVED', true],
    ['APPROVED', false],
    ['PAID', true],
    ['PAID', false],
  ] as const)('rejects a %s own month as closed (wholePeriod=%s)', (status, wholePeriod) => {
    expect(() =>
      assertCommissionPlanEffectiveFrom({
        ...input,
        wholePeriod,
        locked: [locked('2026-10', status)],
      }),
    ).toThrowError(expect.objectContaining({ code: 'COMMISSION_PERIOD_CLOSED' }));
  });

  it('returns an ordinary own REVIEWED month before a later REVIEWED month', () => {
    expect(
      assertCommissionPlanEffectiveFrom({
        ...input,
        locked: [locked('2026-10', 'REVIEWED'), locked('2026-11', 'REVIEWED')],
      }),
    ).toEqual(['2026-10', '2026-11']);
  });
});

describe('assertCommissionPlanEffectiveFrom later months', () => {
  it.each(['APPROVED', 'PAID'] as const)('rejects a %s later month as closed', (status) => {
    expect(() =>
      assertCommissionPlanEffectiveFrom({
        ...input,
        effectiveFrom: '2026-09-01',
        wholePeriod: true,
        locked: [locked('2026-09', 'DRAFT'), locked('2026-10', status)],
      }),
    ).toThrowError(expect.objectContaining({ code: 'COMMISSION_PERIOD_CLOSED' }));
  });

  it('returns only later REVIEWED months for the atomic return to DRAFT', () => {
    expect(
      assertCommissionPlanEffectiveFrom({
        ...input,
        effectiveFrom: '2026-09-01',
        wholePeriod: true,
        locked: [
          locked('2026-09', 'DRAFT'),
          locked('2026-10', 'REVIEWED'),
          locked('2026-11', 'REVIEWED'),
        ],
      }),
    ).toEqual(['2026-10', '2026-11']);
  });
});

describe('assertCommissionPlanDateBeforeLocks', () => {
  it('refuses an ordinary year-one date before any month is locked', () => {
    expect(() =>
      assertCommissionPlanDateBeforeLocks({
        effectiveFrom: '0001-01-01',
        wholePeriod: false,
        today: '2026-11-02',
        businessStartMonth: '2026-10',
      }),
    ).toThrowError(expect.objectContaining({ code: 'COMMISSION_EFFECTIVE_FROM_PAST' }));
  });

  it('accepts an ordinary version dated today', () => {
    expect(() =>
      assertCommissionPlanDateBeforeLocks({
        effectiveFrom: '2026-11-02',
        wholePeriod: false,
        today: '2026-11-02',
        businessStartMonth: '2026-10',
      }),
    ).not.toThrow();
  });

  it('CM-07b accepts the business start month without an existing statement', () => {
    expect(() =>
      assertCommissionPlanDateBeforeLocks({
        effectiveFrom: '2026-10-01',
        wholePeriod: true,
        today: '2026-11-02',
        businessStartMonth: '2026-10',
      }),
    ).not.toThrow();
  });

  it('refuses a whole_period month before the business start month', () => {
    expect(() =>
      assertCommissionPlanDateBeforeLocks({
        effectiveFrom: '2026-09-01',
        wholePeriod: true,
        today: '2026-11-02',
        businessStartMonth: '2026-10',
      }),
    ).toThrowError(expect.objectContaining({ code: 'COMMISSION_PERIOD_BEFORE_BUSINESS' }));
  });

  it('refuses a whole_period date from 2001 before the business existed', () => {
    expect(() =>
      assertCommissionPlanDateBeforeLocks({
        effectiveFrom: '2001-01-01',
        wholePeriod: true,
        today: '2026-11-02',
        businessStartMonth: '2026-10',
      }),
    ).toThrowError(expect.objectContaining({ code: 'COMMISSION_PERIOD_BEFORE_BUSINESS' }));
  });
});

describe('commissionPlanMonthsStillToLock', () => {
  it('returns nothing when every required month is already locked', () => {
    expect(commissionPlanMonthsStillToLock('2026-10-01', '2026-10-30', ['2026-10'])).toEqual([]);
  });

  it('returns only the new current month after a local-month rollover', () => {
    expect(commissionPlanMonthsStillToLock('2026-10-01', '2026-11-01', ['2026-10'])).toEqual([
      '2026-11',
    ]);
  });
});

describe('nextCommissionPlanVersion', () => {
  it('starts at one and increments the previous maximum', () => {
    expect(nextCommissionPlanVersion(null)).toBe(1);
    expect(nextCommissionPlanVersion(7)).toBe(8);
  });

  it('refuses a broken stored maximum', () => {
    expect(() => nextCommissionPlanVersion(0)).toThrow(RangeError);
    expect(() => nextCommissionPlanVersion(1.5)).toThrow(RangeError);
  });
});
