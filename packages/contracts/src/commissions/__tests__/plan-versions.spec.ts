import { expect, it } from 'vitest';

import {
  commissionEffectiveFromPastError,
  commissionPlanVersion,
  commissionPlanVersionListQuery,
  createCommissionPlanVersionInput,
} from '../plan-versions.js';

const cm05 = {
  effective_from: '2026-10-25',
  whole_period: false,
  base: { enabled: false },
  tiers: {
    enabled: true,
    mode: 'MARGINAL',
    accumulator: 'AMOUNT',
    steps: [
      {
        from: { kind: 'SALARY_MULTIPLE', value: '2.00' },
        calc: { kind: 'PCT', bps: 500 },
      },
    ],
  },
  package_sale: { enabled: false },
};

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected a commission tier step');
  return value;
}

const response = {
  id: '01920000-0000-7000-8000-000000000101',
  employee_id: '01920000-0000-7000-8000-000000000102',
  version: 1,
  ...cm05,
  repair_period: null,
  created_at: '2026-10-25T10:00:00Z',
  created_by: '01920000-0000-7000-8000-000000000103',
};

it('accepts the CM-05 salary-multiple marginal plan', () => {
  expect(createCommissionPlanVersionInput.parse(cm05)).toEqual(cm05);
});

it('refuses unknown keys', () => {
  expect(createCommissionPlanVersionInput.safeParse({ ...cm05, unexpected: true }).success).toBe(
    false,
  );
});

it('refuses fractional PCT bps while leaving the range to the engine', () => {
  const value = {
    ...cm05,
    base: { enabled: true, calc: { kind: 'PCT', bps: 1.5 } },
  };
  expect(createCommissionPlanVersionInput.safeParse(value).success).toBe(false);
  expect(
    createCommissionPlanVersionInput.safeParse({
      ...cm05,
      base: { enabled: true, calc: { kind: 'PCT', bps: 10001 } },
    }).success,
  ).toBe(true);
});

it.each(['1.5', '-1.000'])('refuses invalid FIXED amount %s', (amount) => {
  const value = {
    ...cm05,
    base: { enabled: true, calc: { kind: 'FIXED', amount } },
  };
  expect(createCommissionPlanVersionInput.safeParse(value).success).toBe(false);
});

it("refuses SALARY_MULTIPLE '2' without two decimals", () => {
  const value = JSON.parse(JSON.stringify(cm05)) as typeof cm05;
  required(value.tiers.steps[0]).from.value = '2';
  expect(createCommissionPlanVersionInput.safeParse(value).success).toBe(false);
});

it('refuses a year-0000 effective date', () => {
  expect(
    createCommissionPlanVersionInput.safeParse({ ...cm05, effective_from: '0000-01-01' }).success,
  ).toBe(false);
});

it('leaves an empty enabled steps array to the engine validation', () => {
  const value = { ...cm05, tiers: { ...cm05.tiers, steps: [] } };
  expect(createCommissionPlanVersionInput.safeParse(value).success).toBe(true);
});

it('accepts 25 enabled steps', () => {
  const steps = Array.from({ length: 25 }, (_unused, index) => ({
    from: { kind: 'SALARY_MULTIPLE', value: `${index + 2}.00` },
    calc: { kind: 'PCT', bps: 500 },
  }));
  const value = { ...cm05, tiers: { ...cm05.tiers, steps } };
  expect(createCommissionPlanVersionInput.parse(value)).toEqual(value);
});

it('accepts a disabled base that keeps its calc', () => {
  const value = { ...cm05, base: { enabled: false, calc: { kind: 'PCT', bps: 500 } } };
  expect(createCommissionPlanVersionInput.parse(value)).toEqual(value);
});

it('accepts disabled tiers that keep their settings and an empty steps array', () => {
  const value = {
    ...cm05,
    tiers: { enabled: false, mode: 'MARGINAL', accumulator: 'AMOUNT', steps: [] },
  };
  expect(createCommissionPlanVersionInput.parse(value)).toEqual(value);
});

it('publishes the past effective date refusal with its own code', () => {
  const refusal = {
    code: 'COMMISSION_EFFECTIVE_FROM_PAST',
    message_ar: 'تاريخ البداية لازم يكون النهارده أو بعده.',
    message_en: 'The start date must be today or later.',
  };
  expect(commissionEffectiveFromPastError.parse(refusal)).toEqual(refusal);
});

it('refuses another code in the past effective date envelope', () => {
  expect(
    commissionEffectiveFromPastError.safeParse({
      code: 'COMMISSION_PLAN_INVALID',
      message_ar: 'الخطة غير صالحة.',
      message_en: 'The plan is invalid.',
    }).success,
  ).toBe(false);
});

it('rejects an extra response key', () => {
  expect(commissionPlanVersion.safeParse({ ...response, salary: '500.000' }).success).toBe(false);
});

it('defaults the list query limit to 20', () => {
  expect(commissionPlanVersionListQuery.parse({})).toEqual({ limit: 20 });
});
