import { describe, expect, it } from 'vitest';

import {
  assertCommissionPlanEffectiveFrom,
  assertWholePeriodMonthTracked,
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

describe('assertWholePeriodMonthTracked', () => {
  it('refuses a past whole_period month before the first tracked statement', () => {
    expect(() =>
      assertWholePeriodMonthTracked({
        effectiveFrom: '2026-08-01',
        wholePeriod: true,
        today: '2026-10-30',
        firstStatementPeriod: '2026-09',
      }),
    ).toThrowError(expect.objectContaining({ code: 'COMMISSION_PERIOD_NOT_DRAFT' }));
  });

  it('refuses a past whole_period month when the business has no statements', () => {
    expect(() =>
      assertWholePeriodMonthTracked({
        effectiveFrom: '2026-09-01',
        wholePeriod: true,
        today: '2026-10-30',
        firstStatementPeriod: null,
      }),
    ).toThrowError(expect.objectContaining({ code: 'COMMISSION_PERIOD_NOT_DRAFT' }));
  });

  it('accepts the first tracked month for a past whole_period version', () => {
    expect(() =>
      assertWholePeriodMonthTracked({
        effectiveFrom: '2026-09-01',
        wholePeriod: true,
        today: '2026-10-30',
        firstStatementPeriod: '2026-09',
      }),
    ).not.toThrow();
  });

  it('accepts a current whole_period month when no statement exists yet', () => {
    expect(() =>
      assertWholePeriodMonthTracked({
        effectiveFrom: '2026-10-01',
        wholePeriod: true,
        today: '2026-10-30',
        firstStatementPeriod: null,
      }),
    ).not.toThrow();
  });

  it('does not refuse an ordinary version before the first tracked month', () => {
    expect(() =>
      assertWholePeriodMonthTracked({
        effectiveFrom: '2001-01-01',
        wholePeriod: false,
        today: '2026-10-30',
        firstStatementPeriod: null,
      }),
    ).not.toThrow();
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
