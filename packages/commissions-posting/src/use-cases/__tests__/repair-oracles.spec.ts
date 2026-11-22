import type { CommissionPlanVersion } from '@pospay/commissions-engine';
import { expect, it } from 'vitest';

import { computeCommissionCorrections } from '../../domain/commission-correction-step.ts';
import type {
  CommissionMonthLine,
  CommissionMonthProjection,
} from '../../ports/commission-correction.port.ts';
import { recomputeCommissionMonth } from '../commission-month-recompute.ts';

/**
 * أوراكل مبالغ إصلاح الشهر (plan-55-2.md §7.2 و§7.4): كل رقم متوقع هنا مكتوب بيد من قواعد الخطة،
 * مش منقول من ناتج الكود. لو المحرك رجّع رقماً مختلفاً توقف ونبلّغ المدير (CS-Q47).
 */
const HEBA = 'employee-heba';
const BRANCH = 'branch-a';

const pct = (bps: bigint) => ({ kind: 'PCT' as const, value: bps });

const version = (patch: Partial<CommissionPlanVersion>): CommissionPlanVersion => ({
  employeeId: HEBA,
  effectiveFrom: '2026-09-15',
  wholePeriod: false,
  repairPeriod: null,
  createdAt: 1n,
  version: 1n,
  base: { enabled: false },
  tiers: { enabled: false },
  packageSale: { enabled: false },
  ...patch,
});

/** خطة الإصلاح R: أساسي 5% وشرائح مقفولة، سارية في سبتمبر وحده. */
const repairPlan = (): CommissionPlanVersion =>
  version({
    effectiveFrom: '2026-09-01',
    repairPeriod: '2026-09',
    createdAt: 2n,
    version: 2n,
    base: { enabled: true, calc: pct(500n) },
  });

const line = (
  lineId: string,
  businessDate: string,
  net: bigint,
  order: bigint,
): CommissionMonthLine => ({
  employeeId: HEBA,
  serviceId: 'service-a',
  branchId: BRANCH,
  lineId,
  occurredAt: order,
  recordedAt: order,
  businessDate,
  netShare: net,
  shareBps: 10_000n,
  counts: true,
  ruleSnapshot: { kind: 'FOLLOW_PLAN' },
  status: 'ACTIVE',
});

const month = (patch: Partial<CommissionMonthProjection>): CommissionMonthProjection => ({
  employeeId: HEBA,
  period: '2026-09',
  lines: [],
  sales: [],
  salaries: [],
  versions: [],
  overrides: [],
  tips: [],
  corrections: [],
  ...patch,
});

const attribution = (businessDate: string) => ({
  sourceBranchId: BRANCH,
  sourceBusinessDate: businessDate,
  attachedBranchIds: [BRANCH],
});

const recomputedAmounts = (projection: CommissionMonthProjection): Record<string, bigint> => {
  const result = recomputeCommissionMonth(projection);
  if (!result.ok) throw new Error(`expected a priced month, got ${result.code}`);
  return Object.fromEntries(result.sources.map((source) => [source.sourceRef, source.amount]));
};

/** V1 للمثال O2: الأساسي مقفول والشرائح هامشية على المبلغ بحد 400.000 يدفع 10%. */
const tieredPlan = (): CommissionPlanVersion =>
  version({
    tiers: {
      enabled: true,
      accumulator: 'AMOUNT',
      mode: 'MARGINAL',
      steps: [{ from: { kind: 'AMOUNT', value: 400_000n }, calc: pct(1000n) }],
    },
  });

const O2_LINES = [
  line('L1', '2026-09-10', 200_000n, 1n),
  line('L2', '2026-09-20', 300_000n, 2n),
  line('L3', '2026-09-25', 300_000n, 3n),
];

it('O2 before the repair the late line has no plan, so the month is blocked', () => {
  const result = recomputeCommissionMonth(month({ lines: O2_LINES, versions: [tieredPlan()] }));
  expect(result).toEqual({ ok: false, code: 'NO_PLAN' });
});

it('O2 after the repair the late line counts in the month tier total (CS-Q47)', () => {
  const amounts = recomputedAmounts(
    month({ lines: O2_LINES, versions: [tieredPlan(), repairPlan()] }),
  );
  // L1 تحت R: 200.000 × 5% = 10.000؛ L2 يمر من 200.000 إلى 500.000 فيدفع (500−400)×10% = 10.000؛
  // L3 من 500.000 إلى 800.000 كله فوق الحد: 300.000 × 10% = 30.000.
  expect(amounts).toEqual({ 'line:L1': 10_000n, 'line:L2': 10_000n, 'line:L3': 30_000n });
});

it('O2 the corrections against the frozen September are +10.000 for each of the three lines', () => {
  const amounts = recomputedAmounts(
    month({ lines: O2_LINES, versions: [tieredPlan(), repairPlan()] }),
  );
  const drafts = computeCommissionCorrections({
    sourcePeriod: '2026-09',
    employeeId: HEBA,
    generation: 1,
    targetPeriod: '2026-10',
    targetStatementId: 'statement-oct',
    eventId: 'first-event',
    // المجمّد وقت الاعتماد بدون L1: L2 تحت الحد = 0، L3 من 300.000 إلى 600.000 = (600−400)×10% = 20.000.
    frozen: [
      {
        sourceRef: 'line:L2',
        kind: 'COMMISSION',
        amount: 0n,
        attribution: attribution('2026-09-20'),
      },
      {
        sourceRef: 'line:L3',
        kind: 'COMMISSION',
        amount: 20_000n,
        attribution: attribution('2026-09-25'),
      },
    ],
    posted: [],
    recomputed: [
      {
        sourceRef: 'line:L1',
        kind: 'COMMISSION',
        amount: amounts['line:L1']!,
        attribution: attribution('2026-09-10'),
      },
      { sourceRef: 'line:L2', kind: 'COMMISSION', amount: amounts['line:L2']! },
      { sourceRef: 'line:L3', kind: 'COMMISSION', amount: amounts['line:L3']! },
    ],
  });

  expect(
    drafts.map((draft) => [draft.sourceRef, draft.previousAmount, draft.newAmount, draft.amount]),
  ).toEqual([
    ['line:L1', 0n, 10_000n, 10_000n],
    ['line:L2', 0n, 10_000n, 10_000n],
    ['line:L3', 20_000n, 30_000n, 10_000n],
  ]);
  expect(drafts.reduce((total, draft) => total + draft.amount, 0n)).toBe(30_000n);
});

/** V2 للمثال O4: من 15 سبتمبر، شرائح بمضاعف راتب 1.00 يدفع 10%، والراتب 500.000 من أول سبتمبر. */
const salaryPlan = (): CommissionPlanVersion =>
  version({
    tiers: {
      enabled: true,
      accumulator: 'AMOUNT',
      mode: 'MARGINAL',
      steps: [{ from: { kind: 'SALARY_MULTIPLE', value: 100n }, calc: pct(1000n) }],
    },
  });
const SALARY = { employeeId: HEBA, effectiveFrom: '2026-09-01', amount: 500_000n };
const La = line('La', '2026-09-20', 700_000n, 2n);
const Lb = line('Lb', '2026-09-10', 200_000n, 1n);

it('O4a the code order: a missing salary alone, then a missing plan that outranks it', () => {
  expect(recomputeCommissionMonth(month({ lines: [La], versions: [salaryPlan()] }))).toEqual({
    ok: false,
    code: 'NO_SALARY',
  });
  expect(recomputeCommissionMonth(month({ lines: [La, Lb], versions: [salaryPlan()] }))).toEqual({
    ok: false,
    code: 'NO_PLAN',
  });
  expect(
    recomputeCommissionMonth(
      month({ lines: [La, Lb], versions: [salaryPlan()], salaries: [SALARY] }),
    ),
  ).toEqual({ ok: false, code: 'NO_PLAN' });
});

it('O4 after the repair the two lines price as +10.000 and +40.000 with the accumulator carried across them', () => {
  const amounts = recomputedAmounts(
    month({ lines: [La, Lb], versions: [salaryPlan(), repairPlan()], salaries: [SALARY] }),
  );
  // Lb تحت R: 200.000 × 5% = 10.000 والمجمّع يتحرك 0 → 200.000؛
  // La تحت V2: من 200.000 إلى 900.000 فوق عتبة 500.000: (900−500)×10% = 40.000.
  expect(amounts).toEqual({ 'line:Lb': 10_000n, 'line:La': 40_000n });
});
