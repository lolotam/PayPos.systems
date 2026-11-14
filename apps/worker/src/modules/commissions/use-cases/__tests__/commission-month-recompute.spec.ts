import type { CommissionPlanVersion } from '@pospay/commissions-engine';
import { expect, it } from 'vitest';

import type {
  CommissionMonthLine,
  CommissionMonthProjection,
  CommissionMonthTip,
} from '../../ports/commission-correction.port.ts';
import { recomputeCommissionMonth } from '../commission-month-recompute.ts';

const EMPLOYEE = 'employee-a';

const version = (): CommissionPlanVersion => ({
  employeeId: EMPLOYEE,
  effectiveFrom: '2026-10-01',
  wholePeriod: false,
  createdAt: 1n,
  version: 1n,
  base: { enabled: true, calc: { kind: 'PCT', value: 1000n } },
  tiers: { enabled: false },
  packageSale: { enabled: false },
});

const salaryPlan = (): CommissionPlanVersion => ({
  ...version(),
  base: { enabled: false },
  tiers: {
    enabled: true,
    accumulator: 'AMOUNT',
    mode: 'MARGINAL',
    steps: [{ from: { kind: 'SALARY_MULTIPLE', value: 200n }, calc: { kind: 'PCT', value: 500n } }],
  },
});

const line = (patch: Partial<CommissionMonthLine> = {}): CommissionMonthLine => ({
  employeeId: EMPLOYEE,
  serviceId: 'service-a',
  branchId: 'branch-a',
  lineId: 'line-a',
  occurredAt: 1n,
  recordedAt: 1n,
  businessDate: '2026-10-10',
  netShare: 100_000n,
  shareBps: 10_000n,
  counts: true,
  ruleSnapshot: { kind: 'FOLLOW_PLAN' },
  status: 'ACTIVE',
  ...patch,
});

const tip = (patch: Partial<CommissionMonthTip> = {}): CommissionMonthTip => ({
  sessionId: 'session-a',
  employeeId: EMPLOYEE,
  branchId: 'branch-a',
  businessDate: '2026-10-10',
  method: 'CARD',
  amount: 5_000n,
  ...patch,
});

const projection = (patch: Partial<CommissionMonthProjection> = {}): CommissionMonthProjection => ({
  employeeId: EMPLOYEE,
  period: '2026-10',
  lines: [],
  sales: [],
  salaries: [],
  versions: [version()],
  overrides: [],
  tips: [],
  corrections: [],
  ...patch,
});

it('prices the month and returns every priced source by its reference', () => {
  const result = recomputeCommissionMonth(projection({ lines: [line()] }));
  expect(result).toEqual({
    ok: true,
    sources: [
      {
        sourceRef: 'line:line-a',
        kind: 'COMMISSION',
        amount: 10_000n,
        sourceBranchId: 'branch-a',
        sourceBusinessDate: '2026-10-10',
      },
    ],
  });
});

it('leaves the cancelled line out of the recomputed sources', () => {
  const result = recomputeCommissionMonth(
    projection({
      lines: [line({ lineId: 'line-a' }), line({ lineId: 'line-cancelled', status: 'CANCELLED' })],
    }),
  );
  expect(result).toEqual({
    ok: true,
    sources: [
      {
        sourceRef: 'line:line-a',
        kind: 'COMMISSION',
        amount: 10_000n,
        sourceBranchId: 'branch-a',
        sourceBusinessDate: '2026-10-10',
      },
    ],
  });
});

it('passes the tips through unpriced with their own references', () => {
  const result = recomputeCommissionMonth(
    projection({
      lines: [line()],
      tips: [tip(), tip({ sessionId: 'session-b', method: 'CASH', amount: 3_000n })],
    }),
  );
  expect(result).toEqual({
    ok: true,
    sources: [
      {
        sourceRef: 'line:line-a',
        kind: 'COMMISSION',
        amount: 10_000n,
        sourceBranchId: 'branch-a',
        sourceBusinessDate: '2026-10-10',
      },
      {
        sourceRef: 'tip:session-a:CARD',
        kind: 'TIP_CARD',
        amount: 5_000n,
        sourceBranchId: 'branch-a',
        sourceBusinessDate: '2026-10-10',
      },
      {
        sourceRef: 'tip:session-b:CASH',
        kind: 'TIP_CASH',
        amount: 3_000n,
        sourceBranchId: 'branch-a',
        sourceBusinessDate: '2026-10-10',
      },
    ],
  });
});

it('does not treat a correction received by the month as a source', () => {
  const expected = recomputeCommissionMonth(projection({ lines: [line()], tips: [tip()] }));
  const result = recomputeCommissionMonth(
    projection({
      lines: [line()],
      tips: [tip()],
      corrections: [
        {
          employeeId: EMPLOYEE,
          sourcePeriod: '2026-09',
          targetPeriod: '2026-10',
          sourceRef: 'line:received-correction',
          kind: 'COMMISSION',
          amount: 99_000n,
          previousAmount: 0n,
          newAmount: 99_000n,
          generation: 1n,
        },
      ],
    }),
  );
  expect(result).toEqual(expected);
  expect(
    result.ok && result.sources.some((source) => source.sourceRef === 'line:received-correction'),
  ).toBe(false);
});

it('propagates the missing plan instead of pricing nothing', () => {
  expect(recomputeCommissionMonth(projection({ lines: [line()], versions: [] }))).toEqual({
    ok: false,
    code: 'NO_PLAN',
  });
});

it('propagates the missing salary instead of pricing nothing', () => {
  expect(
    recomputeCommissionMonth(projection({ lines: [line()], versions: [salaryPlan()] })),
  ).toEqual({ ok: false, code: 'NO_SALARY' });
});

it('prices the month when the salary the plan needs is there', () => {
  const result = recomputeCommissionMonth(
    projection({
      lines: [line()],
      versions: [salaryPlan()],
      salaries: [{ employeeId: EMPLOYEE, effectiveFrom: '2026-10-01', amount: 500_000n }],
    }),
  );
  expect(result.ok).toBe(true);
});

it('returns the same result whatever the order of the inputs', () => {
  const first = recomputeCommissionMonth(
    projection({ lines: [line({ lineId: 'line-b' }), line({ lineId: 'line-a' })], tips: [tip()] }),
  );
  const second = recomputeCommissionMonth(
    projection({ lines: [line({ lineId: 'line-a' }), line({ lineId: 'line-b' })], tips: [tip()] }),
  );
  expect(first).toEqual(second);
  expect(first.ok && first.sources.map((source) => source.sourceRef)).toEqual([
    'line:line-a',
    'line:line-b',
    'tip:session-a:CARD',
  ]);
});

it('returns an empty source list for a month without any source', () => {
  expect(recomputeCommissionMonth(projection())).toEqual({ ok: true, sources: [] });
});
