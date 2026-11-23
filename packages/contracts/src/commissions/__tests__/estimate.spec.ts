import { describe, expect, it } from 'vitest';

import { buildOpenApiDocument } from '../../openapi.js';
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
      service_id: '01920000-0000-7000-8000-0000000000d1',
      service_name: 'Manicure',
    },
  ],
  sales: [],
  tips: { card: '1.500', cash: '0.500' },
  corrections: [],
  carries: { commission: '0.000', tip_card: '0.000' },
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

  it('accepts a null total for the business and for the employee', () => {
    const business = commissionEstimate.safeParse({
      business_id: '01920000-0000-7000-8000-0000000000b1',
      period: '2026-10',
      employees: [{ ...employee, status: 'NO_PLAN', total: null }],
      partial: false,
      total: null,
    });
    expect(business.success).toBe(true);

    const malformed = commissionEstimate.safeParse({
      business_id: '01920000-0000-7000-8000-0000000000b1',
      period: '2026-10',
      employees: [employee],
      partial: false,
      total: '3.00',
    });
    expect(malformed.success).toBe(false);
  });
});

describe('the estimate carries', () => {
  it('accepts a negative carry of each kind and refuses a missing or malformed one', () => {
    const parse = (carries: unknown) =>
      commissionEstimate.safeParse({
        business_id: '01920000-0000-7000-8000-0000000000b1',
        period: '2026-10',
        employees: [{ ...employee, carries }],
        partial: false,
        total: '3.000',
      }).success;
    expect(parse({ commission: '-5.000', tip_card: '-2.000' })).toBe(true);
    expect(parse(undefined)).toBe(false);
    expect(parse({ commission: '-5.000' })).toBe(false);
    expect(parse({ commission: -5, tip_card: '0.000' })).toBe(false);
  });
});

describe('the estimate totals in the OpenAPI document', () => {
  it('admits null on both totals with the monetary pattern kept', () => {
    const document = buildOpenApiDocument();
    const schemas = (
      document['components'] as { schemas: Record<string, { properties?: Record<string, unknown> }> }
    ).schemas;
    for (const name of ['CommissionEstimate', 'CommissionEstimateEmployee']) {
      const total = schemas[name]?.['properties']?.['total'];
      // OpenAPI 3.0 بيقبل null بس مع type في نفس السكيما؛ الـ allOf فوق $ref
      // ما كانش بيقبل null خالص.
      expect(total).toEqual({
        nullable: true,
        type: 'string',
        pattern: '^-?(0|[1-9]\\d{0,10})\\.\\d{3}$',
      });
    }
  });
});
