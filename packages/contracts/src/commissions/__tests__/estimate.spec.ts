import { describe, expect, it } from 'vitest';

import {
  commissionEstimate,
  commissionEstimateMoney,
  commissionEstimatePeriod,
  commissionEstimateQuery,
} from '../estimate.js';

const employee = {
  employee_id: '01920000-0000-7000-8000-0000000000e1',
  name_ar: 'سارة',
  name_en: 'Sarah',
  employee_number: 1,
  status: 'OK' as const,
  partial: false,
  total: '3.000',
  sources: [
    {
      source_ref: 'line:01920000-0000-7000-8000-0000000000d5',
      kind: 'COMMISSION' as const,
      amount: '3.000',
      source_branch_id: '01920000-0000-7000-8000-0000000000c1',
      source_business_date: '2026-10-15',
    },
  ],
  sales: [],
  tips: { card: '1.500', cash: '0.500' },
  corrections: [],
};

describe('commissionEstimatePeriod', () => {
  it('accepts a calendar month', () => {
    expect(commissionEstimatePeriod.safeParse('2026-10').success).toBe(true);
  });

  it('refuses a month that is not YYYY-MM', () => {
    for (const value of ['2026-13', '2026-00', '202610', '2026-1', '0000-01']) {
      expect(commissionEstimatePeriod.safeParse(value).success).toBe(false);
    }
  });
});

describe('commissionEstimateMoney', () => {
  it('keeps three decimals and a signed amount', () => {
    expect(commissionEstimateMoney.safeParse('0.000').success).toBe(true);
    expect(commissionEstimateMoney.safeParse('-2.000').success).toBe(true);
    expect(commissionEstimateMoney.safeParse('120.500').success).toBe(true);
  });

  it('refuses a number, two decimals or four decimals', () => {
    for (const value of [3, '3', '3.00', '3.0000', '3,000']) {
      expect(commissionEstimateMoney.safeParse(value).success).toBe(false);
    }
  });
});

describe('commissionEstimateQuery', () => {
  it('accepts no employee and one employee id', () => {
    expect(commissionEstimateQuery.safeParse({}).success).toBe(true);
    expect(
      commissionEstimateQuery.safeParse({ employee_id: employee.employee_id }).success,
    ).toBe(true);
  });

  it('refuses an unknown key and a malformed employee id', () => {
    expect(commissionEstimateQuery.safeParse({ employee: employee.employee_id }).success).toBe(false);
    expect(commissionEstimateQuery.safeParse({ employee_id: 'nope' }).success).toBe(false);
  });
});

describe('commissionEstimate', () => {
  it('accepts the employee shape with the tips split by method', () => {
    expect(
      commissionEstimate.safeParse({
        business_id: '01920000-0000-7000-8000-0000000000b1',
        period: '2026-10',
        employees: [employee],
        partial: false,
        total: '3.000',
      }).success,
    ).toBe(true);
  });

  it('refuses a total that is not a three-decimal string', () => {
    expect(
      commissionEstimate.safeParse({
        business_id: '01920000-0000-7000-8000-0000000000b1',
        period: '2026-10',
        employees: [employee],
        partial: false,
        total: 3,
      }).success,
    ).toBe(false);
  });

  it('refuses an employee whose status is outside OK, NO_PLAN and NO_SALARY', () => {
    expect(
      commissionEstimate.safeParse({
        business_id: '01920000-0000-7000-8000-0000000000b1',
        period: '2026-10',
        employees: [{ ...employee, status: 'PARTIAL' }],
        partial: false,
        total: '3.000',
      }).success,
    ).toBe(false);
  });
});
