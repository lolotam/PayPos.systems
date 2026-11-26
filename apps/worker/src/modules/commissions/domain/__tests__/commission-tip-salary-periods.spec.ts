import { describe, expect, it } from 'vitest';

import type {
  CommissionTipProjectionRow,
  CommissionTipProjectionSession,
} from '../commission-tip-salary-inputs.ts';

import {
  affectedCommissionTipEmployees,
  assertSalaryIdentityUnchanged,
  assertTipIdentityUnchanged,
  salaryAffectedPeriods,
  tipAffectedPeriods,
} from '../commission-tip-salary-periods.ts';
import {
  CommissionCandidateRangeExceededError,
  CommissionPeriodInvalidError,
  CommissionTipSalaryInputInvalidError,
} from '../errors.ts';

const businessLower = '01920000-0000-7000-8000-000000000aa1';
const businessUpper = '01920000-0000-7000-8000-000000000AA1';
const businessOther = '01920000-0000-7000-8000-000000000bb2';

describe('salaryAffectedPeriods - start period and next_from boundaries', () => {
  it('D2 floors salary affected periods at the business start month', () => {
    const affected = salaryAffectedPeriods('2015-06-01', null, '2026-03', '2026-01');
    expect(affected).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('returns empty when business start month is after current period', () => {
    expect(salaryAffectedPeriods('2026-01-01', null, '2026-03', '2026-05')).toEqual([]);
  });

  it('includes periods when start period equals effective month', () => {
    const affected = salaryAffectedPeriods('2026-01-15', null, '2026-03', '2026-01');
    expect(affected).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('excludes April when effective 2026-04-15 with next 2026-04-30', () => {
    const affected = salaryAffectedPeriods('2026-04-15', '2026-04-30', '2026-06', '2026-01');
    expect(affected).toEqual([]);
  });

  it('includes April when effective 2026-04-15 with next 2026-05-01', () => {
    const affected = salaryAffectedPeriods('2026-04-15', '2026-05-01', '2026-06', '2026-01');
    expect(affected).toEqual(['2026-04']);
  });

  it('includes April when effective on month-end 2026-04-30', () => {
    const affected = salaryAffectedPeriods('2026-04-30', null, '2026-05', '2026-01');
    expect(affected).toEqual(['2026-04', '2026-05']);
  });
});

describe('salaryAffectedPeriods - calendar rules and ranges', () => {
  it('handles leap year 2028-02-29 and non-leap year 2027-02-28 correctly', () => {
    expect(salaryAffectedPeriods('2028-02-29', null, '2028-03', '2028-01')).toEqual([
      '2028-02',
      '2028-03',
    ]);
    expect(salaryAffectedPeriods('2028-02-15', '2028-02-29', '2028-03', '2028-01')).toEqual([]);
    expect(salaryAffectedPeriods('2027-02-28', null, '2027-03', '2027-01')).toEqual([
      '2027-02',
      '2027-03',
    ]);
    expect(salaryAffectedPeriods('2027-02-15', '2027-02-28', '2027-03', '2027-01')).toEqual([]);
    expect(salaryAffectedPeriods('2027-02-15', '2027-03-01', '2027-03', '2027-01')).toEqual([
      '2027-02',
    ]);
  });

  it('caps open-ended salary range at the current month', () => {
    const affected = salaryAffectedPeriods('2026-01-01', null, '2026-04', '2026-01');
    expect(affected).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
  });

  it('returns empty for future-only entry or entry effective after current month', () => {
    expect(salaryAffectedPeriods('2027-01-01', null, '2026-12', '2026-01')).toEqual([]);
    expect(salaryAffectedPeriods('2026-07-01', null, '2026-06', '2026-01')).toEqual([]);
  });

  it('returns unique ascending periods across multi-year boundaries', () => {
    const affected = salaryAffectedPeriods('2025-11-15', null, '2027-02', '2025-01');
    expect(affected).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
    const sortedUnique = [...new Set(affected)].sort();
    expect(affected).toEqual(sortedUnique);
  });
});

describe('salaryAffectedPeriods - the candidate range and the month format', () => {
  it('refuses a range longer than the maximum number of candidate periods', () => {
    // المدى من شهر إنشاء النشاط للشهر الحالي بيقف عند الحد، فيترفض بدل أقفال بلا نهاية.
    expect(() => salaryAffectedPeriods('2015-06-01', null, '2036-02', '2015-06')).toThrow(
      CommissionCandidateRangeExceededError,
    );
    expect(() => salaryAffectedPeriods('2015-06-01', null, '2036-02', '2015-06')).toThrow(
      expect.objectContaining({ code: 'COMMISSION_CANDIDATE_RANGE_EXCEEDED' }),
    );
  });

  it('preserves an empty salary range over a long span without refusing on the cap', () => {
    expect(salaryAffectedPeriods('2015-06-15', '2015-06-30', '2026-06', '2015-06')).toEqual([]);
  });

  it('refuses a current period that is not a calendar month', () => {
    expect(() => salaryAffectedPeriods('2026-01-01', null, '2026-13', '2026-01')).toThrow(
      CommissionPeriodInvalidError,
    );
  });
});

describe('tipAffectedPeriods', () => {
  it('unions, dedups and sorts held period and new business date period', () => {
    expect(tipAffectedPeriods('2026-10', '2026-11-15')).toEqual(['2026-10', '2026-11']);
    expect(tipAffectedPeriods('2026-11', '2026-09-15')).toEqual(['2026-09', '2026-11']);
    expect(tipAffectedPeriods('2026-11', '2026-11-20')).toEqual(['2026-11']);
  });

  it('returns only the new period when held is null', () => {
    expect(tipAffectedPeriods(null, '2026-11-15')).toEqual(['2026-11']);
  });
});

const tipRow = (
  employeeId: string,
  method: 'CARD' | 'CASH' = 'CARD',
  amount = 5_000n,
): CommissionTipProjectionRow => ({ employeeId, method, amount });
const held = (
  period: string,
  rows: readonly CommissionTipProjectionRow[],
): Pick<CommissionTipProjectionSession, 'rows'> & { period: string } => ({ period, rows });
const next = (
  businessDate: string,
  rows: readonly CommissionTipProjectionRow[],
): Pick<CommissionTipProjectionSession, 'businessDate' | 'rows'> => ({ businessDate, rows });
const employeeB = '01920000-0000-7000-8000-00000000000b';
const employeeC = '01920000-0000-7000-8000-00000000000c';

describe('affectedCommissionTipEmployees - who is corrected', () => {
  it('D1 pairs every employee of the new rows when there is no held session', () => {
    expect(
      affectedCommissionTipEmployees(
        null,
        next('2026-10-15', [tipRow(employeeB), tipRow(employeeC, 'CASH')]),
        ['2026-10'],
      ),
    ).toEqual([
      { period: '2026-10', employeeId: employeeB },
      { period: '2026-10', employeeId: employeeC },
    ]);
  });

  it('D2 keeps the employee whose tip the new event removed under the held period', () => {
    expect(
      affectedCommissionTipEmployees(held('2026-10', [tipRow(employeeB)]), next('2026-10-15', []), [
        '2026-10',
      ]),
    ).toEqual([{ period: '2026-10', employeeId: employeeB }]);
  });

  it('D3 a session moved between closed months pairs held employees with the held month and new employees with the new month', () => {
    expect(
      affectedCommissionTipEmployees(
        held('2026-09', [tipRow(employeeB)]),
        next('2026-10-15', [tipRow(employeeC)]),
        ['2026-09', '2026-10'],
      ),
    ).toEqual([
      { period: '2026-09', employeeId: employeeB },
      { period: '2026-10', employeeId: employeeC },
    ]);
  });

  it('D4 drops the pairs of whichever month is open', () => {
    expect(
      affectedCommissionTipEmployees(
        held('2026-09', [tipRow(employeeB)]),
        next('2026-10-15', [tipRow(employeeB), tipRow(employeeC)]),
        ['2026-09'],
      ),
    ).toEqual([{ period: '2026-09', employeeId: employeeB }]);
  });
});

describe('affectedCommissionTipEmployees - dedup and ordering', () => {
  it('D5 one employee with a CARD and a CASH row is one pair, not two', () => {
    expect(
      affectedCommissionTipEmployees(
        null,
        next('2026-10-15', [tipRow(employeeB, 'CARD'), tipRow(employeeB, 'CASH', 3_000n)]),
        ['2026-10'],
      ),
    ).toEqual([{ period: '2026-10', employeeId: employeeB }]);
  });

  it('D6 returns an empty result when no affected month is closed', () => {
    expect(
      affectedCommissionTipEmployees(
        held('2026-10', [tipRow(employeeB)]),
        next('2026-11-15', [tipRow(employeeC)]),
        [],
      ),
    ).toEqual([]);
  });

  it('D7 sorts by period then employee id whatever the input order', () => {
    expect(
      affectedCommissionTipEmployees(
        held('2026-11', [tipRow(employeeC)]),
        next('2026-10-15', [tipRow(employeeC), tipRow(employeeB)]),
        ['2026-10', '2026-11'],
      ),
    ).toEqual([
      { period: '2026-10', employeeId: employeeB },
      { period: '2026-10', employeeId: employeeC },
      { period: '2026-11', employeeId: employeeC },
    ]);
  });
});

describe('assertTipIdentityUnchanged', () => {
  const tipHeld = {
    sessionId: '01920000-0000-7000-8000-000000000001',
    businessId: businessLower,
    branchId: '01920000-0000-7000-8000-000000000002',
    revision: 1,
    businessDate: '2026-11-01',
    period: '2026-11',
    rows: [],
  };

  const tipEvent = {
    sessionId: '01920000-0000-7000-8000-000000000001',
    businessId: businessLower,
    branchId: '01920000-0000-7000-8000-000000000002',
    revision: 2,
    businessDate: '2026-11-01',
    tips: [],
  };

  it('assertTipIdentityUnchanged passes for null held or matching case-insensitive business', () => {
    expect(() => assertTipIdentityUnchanged(null, tipEvent)).not.toThrow();
    expect(() =>
      assertTipIdentityUnchanged(tipHeld, { ...tipEvent, businessId: businessUpper }),
    ).not.toThrow();
  });

  it('assertTipIdentityUnchanged throws typed error when business changes', () => {
    expect(() =>
      assertTipIdentityUnchanged(tipHeld, { ...tipEvent, businessId: businessOther }),
    ).toThrowError(CommissionTipSalaryInputInvalidError);
    try {
      assertTipIdentityUnchanged(tipHeld, { ...tipEvent, businessId: businessOther });
    } catch (error) {
      expect(error).toMatchObject({
        code: 'COMMISSION_TIP_SALARY_INPUT_INVALID',
        reason: 'TIP_IDENTITY_CHANGED',
      });
    }
  });
});

describe('assertSalaryIdentityUnchanged', () => {
  const salaryHeld = {
    employeeId: '01920000-0000-7000-8000-000000000003',
    businessId: businessLower,
    effectiveFrom: '2026-11-01',
    amount: 500000n,
    revision: 1,
  };

  const salaryEvent = {
    employeeId: '01920000-0000-7000-8000-000000000003',
    businessId: businessLower,
    effectiveFrom: '2026-11-01',
    amount: '500.000',
    revision: 2,
  };

  it('assertSalaryIdentityUnchanged passes for null held or matching case-insensitive business', () => {
    expect(() => assertSalaryIdentityUnchanged(null, salaryEvent)).not.toThrow();
    expect(() =>
      assertSalaryIdentityUnchanged(salaryHeld, { ...salaryEvent, businessId: businessUpper }),
    ).not.toThrow();
  });

  it('assertSalaryIdentityUnchanged throws typed error when business changes', () => {
    expect(() =>
      assertSalaryIdentityUnchanged(salaryHeld, { ...salaryEvent, businessId: businessOther }),
    ).toThrowError(CommissionTipSalaryInputInvalidError);
    try {
      assertSalaryIdentityUnchanged(salaryHeld, { ...salaryEvent, businessId: businessOther });
    } catch (error) {
      expect(error).toMatchObject({
        code: 'COMMISSION_TIP_SALARY_INPUT_INVALID',
        reason: 'SALARY_IDENTITY_CHANGED',
      });
    }
  });
});
