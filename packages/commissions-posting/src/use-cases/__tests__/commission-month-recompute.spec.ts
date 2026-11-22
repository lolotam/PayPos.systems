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
  repairPeriod: null,
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

// خطة المثال المحسوب لاختبارات تصحيحات الراتب: شرط واحد من مضاعف راتب 1.00 يدفع 10%.
const salaryThresholdPlan = (): CommissionPlanVersion => ({
  ...salaryPlan(),
  effectiveFrom: '2025-06-01',
  tiers: {
    enabled: true,
    accumulator: 'AMOUNT',
    mode: 'MARGINAL',
    steps: [
      { from: { kind: 'SALARY_MULTIPLE', value: 100n }, calc: { kind: 'PCT', value: 1000n } },
    ],
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

it('D10 the salary-threshold worked example prices L1 at zero and L2 at the marginal remainder', () => {
  const month = (salaryAmount: bigint) =>
    recomputeCommissionMonth(
      projection({
        period: '2026-01',
        lines: [
          line({
            lineId: 'line-l1',
            netShare: 400_000n,
            occurredAt: 1n,
            businessDate: '2026-01-10',
          }),
          line({
            lineId: 'line-l2',
            netShare: 300_000n,
            occurredAt: 2n,
            businessDate: '2026-01-20',
          }),
        ],
        versions: [salaryThresholdPlan()],
        salaries: [{ employeeId: EMPLOYEE, effectiveFrom: '2026-01-01', amount: salaryAmount }],
      }),
    );
  const amountOf = (result: ReturnType<typeof month>, sourceRef: string): bigint => {
    if (!result.ok) throw new Error(`the month refused with ${result.code}`);
    const source = result.sources.find((row) => row.sourceRef === sourceRef);
    if (source === undefined) throw new Error(`the source ${sourceRef} is missing`);
    return source.amount;
  };

  expect(amountOf(month(500_000n), 'line:line-l1')).toBe(0n);
  expect(amountOf(month(500_000n), 'line:line-l2')).toBe(20_000n);
  expect(amountOf(month(550_000n), 'line:line-l1')).toBe(0n);
  expect(amountOf(month(550_000n), 'line:line-l2')).toBe(15_000n);
  expect(amountOf(month(560_000n), 'line:line-l1')).toBe(0n);
  expect(amountOf(month(560_000n), 'line:line-l2')).toBe(14_000n);
});

it('O1 the flat repair oracle prices the late line at 5% and keeps the priced line at 10%', () => {
  // V1 خطة عادية سريانها 15 سبتمبر بالأساسي 10%؛ R خطة إصلاح سبتمبر بالأساسي 5%.
  const ordinary: CommissionPlanVersion = { ...version(), effectiveFrom: '2026-09-15' };
  const repairPlan: CommissionPlanVersion = {
    ...version(),
    effectiveFrom: '2026-09-01',
    repairPeriod: '2026-09',
    createdAt: 2n,
    version: 2n,
    base: { enabled: true, calc: { kind: 'PCT', value: 500n } },
  };
  const september = (versions: CommissionPlanVersion[]) =>
    recomputeCommissionMonth(
      projection({
        period: '2026-09',
        lines: [
          line({ lineId: 'line-l1', businessDate: '2026-09-10', netShare: 200_000n }),
          line({ lineId: 'line-l2', businessDate: '2026-09-20', netShare: 300_000n }),
        ],
        versions,
      }),
    );

  // قبل الإصلاح: البند المتأخر يوم 10 ماكانش له خطة، فالشهر برمّه مارفضّش يتسعّر.
  expect(september([ordinary])).toEqual({ ok: false, code: 'NO_PLAN' });

  const after = september([ordinary, repairPlan]);
  expect(after.ok).toBe(true);
  if (!after.ok) throw new Error('the repaired month must price');
  const amounts = new Map(after.sources.map((source) => [source.sourceRef, source.amount]));
  // line:l1 بخطة الإصلاح 5%: 200.000 × 5% = 10.000؛ line:l2 على خطتها العادية 10%: 30.000.
  expect(amounts.get('line:line-l1')).toBe(10_000n);
  expect(amounts.get('line:line-l2')).toBe(30_000n);
});

it('O3 the missing-salary month refuses NO_SALARY then prices the line at the marginal remainder', () => {
  // V2 قبل سبتمبر: شرائح بشرط مضاعف راتب 1.00 يدفع 10%؛ هبة بلا مرتب نهائياً.
  const september = (salaries: CommissionMonthProjection['salaries']) =>
    recomputeCommissionMonth(
      projection({
        period: '2026-09',
        lines: [line({ lineId: 'line-l1', businessDate: '2026-09-20', netShare: 700_000n })],
        versions: [salaryThresholdPlan()],
        salaries,
      }),
    );

  // البند المتأخر وحده بلا مرتب: الشهر مرفوض بلا تسعير، وده اللي بيسجّل التوقف (CM-53).
  expect(september([])).toEqual({ ok: false, code: 'NO_SALARY' });

  // الراتب 500.000 من أول سبتمبر: (700.000 − 500.000) × 10% = 20.000 فوق الحد.
  const after = september([
    { employeeId: EMPLOYEE, effectiveFrom: '2026-09-01', amount: 500_000n },
  ]);
  expect(after.ok).toBe(true);
  if (!after.ok) throw new Error('the month must price once the salary exists');
  const amounts = new Map(after.sources.map((source) => [source.sourceRef, source.amount]));
  expect(amounts.get('line:line-l1')).toBe(20_000n);
});

it('O4a the engine error order is NO_SALARY for the later line alone and NO_PLAN once the earlier line has no plan', () => {
  // V2 سريانها 15 سبتمبر: البند La (20) بعدها، والبند Lb (10) قبلها.
  const v2 = { ...salaryThresholdPlan(), effectiveFrom: '2026-09-15' };
  // وقت الخدمة هو ترتيب التسعير (line-order)، فبند يوم 10 مايقدرش يكون حصل بعد بند يوم 20.
  const micros = (iso: string) => BigInt(new Date(iso).getTime()) * 1000n;
  const la = line({
    lineId: 'line-la',
    businessDate: '2026-09-20',
    netShare: 700_000n,
    occurredAt: micros('2026-09-20T09:00:00Z'),
    recordedAt: micros('2026-09-20T09:00:00Z'),
  });
  const lb = line({
    lineId: 'line-lb',
    businessDate: '2026-09-10',
    netShare: 200_000n,
    occurredAt: micros('2026-09-10T09:00:00Z'),
    recordedAt: micros('2026-09-10T09:00:00Z'),
  });
  const salary = { employeeId: EMPLOYEE, effectiveFrom: '2026-09-01', amount: 500_000n };
  const month = (
    lines: readonly (typeof la)[],
    salaries: CommissionMonthProjection['salaries'] = [],
  ) => recomputeCommissionMonth(projection({ period: '2026-09', lines, versions: [v2], salaries }));

  // La وحدها بلا مرتب: NO_SALARY.
  expect(month([la])).toEqual({ ok: false, code: 'NO_SALARY' });
  // Lb قبل الخطة: المحرّك بيسعّر بالترتيب ويقف عندها، فالرمز NO_PLAN حتى مع الراتب موجود.
  expect(month([lb, la])).toEqual({ ok: false, code: 'NO_PLAN' });
  expect(month([lb, la], [salary])).toEqual({ ok: false, code: 'NO_PLAN' });
});
