import { expect, it } from 'vitest';

import { CommissionPlanDecodeError } from '../../domain/errors.ts';
import { commissionPlanVersionOf, type PlanVersionRow } from '../commission-correction-codec.ts';

function row(plan: unknown): PlanVersionRow {
  return {
    employeeId: 'employee-a',
    version: 7,
    effectiveFrom: '2026-10-01',
    wholePeriod: true,
    plan,
    createdAt: '42',
  };
}

type ThresholdKind = 'AMOUNT' | 'SESSIONS' | 'SALARY_MULTIPLE';

function validPlan(kind: ThresholdKind) {
  const value = kind === 'AMOUNT' ? '10.000' : kind === 'SESSIONS' ? 3 : '1.50';
  return {
    base: { enabled: true, calc: { kind: 'PCT', bps: 1000 } },
    tiers: {
      enabled: true,
      mode: 'MARGINAL',
      accumulator: kind === 'SESSIONS' ? 'SESSIONS' : 'AMOUNT',
      steps: [{ from: { kind, value }, calc: { kind: 'PCT', bps: 500 } }],
    },
    package_sale: { enabled: true, calc: { kind: 'FIXED', amount: '2.500' } },
  };
}

it.each([
  ['AMOUNT', 10_000n],
  ['SESSIONS', 3n],
  ['SALARY_MULTIPLE', 150n],
] as const)('round-trips a valid plan with an %s threshold', (kind, thresholdValue) => {
  expect(commissionPlanVersionOf(row(validPlan(kind)))).toEqual({
    employeeId: 'employee-a',
    version: 7n,
    effectiveFrom: '2026-10-01',
    wholePeriod: true,
    createdAt: 42n,
    base: { enabled: true, calc: { kind: 'PCT', value: 1000n } },
    tiers: {
      enabled: true,
      mode: 'MARGINAL',
      accumulator: kind === 'SESSIONS' ? 'SESSIONS' : 'AMOUNT',
      steps: [
        {
          from: { kind, value: thresholdValue },
          calc: { kind: 'PCT', value: 500n },
        },
      ],
    },
    packageSale: { enabled: true, calc: { kind: 'FIXED', value: 2_500n } },
  });
});

function planWithBaseCalc(calc: unknown) {
  return {
    base: { enabled: true, calc },
    tiers: { enabled: false },
    package_sale: { enabled: false },
  };
}

it.each([
  ['missing kind', { bps: 1000 }, 'base.calc.kind'],
  ['unknown kind', { kind: 'UNKNOWN', bps: 1000 }, 'base.calc.kind'],
  ['missing value', { kind: 'PCT' }, 'base.calc.bps'],
  ['wrong value type', { kind: 'PCT', bps: '1000' }, 'base.calc.bps'],
])('throws the typed error for a %s', (_name, calc, fieldPath) => {
  const decode = () => commissionPlanVersionOf(row(planWithBaseCalc(calc)));
  expect(decode).toThrow(CommissionPlanDecodeError);
  expect(decode).toThrowError(
    expect.objectContaining({ code: 'COMMISSION_PLAN_DECODE_INVALID', fieldPath }),
  );
});

it('rejects a decoded plan that the engine considers invalid', () => {
  const decode = () => commissionPlanVersionOf(row(planWithBaseCalc({ kind: 'PCT', bps: 10_001 })));
  expect(decode).toThrowError(
    expect.objectContaining({ code: 'COMMISSION_PLAN_DECODE_INVALID', fieldPath: 'plan' }),
  );
});
