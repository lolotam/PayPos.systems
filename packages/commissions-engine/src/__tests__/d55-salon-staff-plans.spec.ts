import { describe, expect, it } from 'vitest';

import { computePeriod } from '../period-commission.ts';
import { validateCommissionPlan } from '../plan-validation.ts';
import type { CommissionPlanVersion, CommissionSalary } from '../plan-types.ts';
import { line, pct, period, version } from './engine-ii-fixtures.ts';

// D-55 — خطط الصالون الفعلية لأخصائية الأظافر وأخصائية الرموش وأخصائية المساج (2026-10-07).
// الأرقام محسوبة باليد. العمولة على الصافي بعد الخصم، وحد الراتب من راتب آخر يوم.

const salaryOn = (amount: bigint): CommissionSalary => ({
  employeeId: 'employee-a',
  effectiveFrom: '2026-01-01',
  amount,
});

const expectPeriod = (
  plan: CommissionPlanVersion,
  shares: readonly bigint[],
  salaries: readonly CommissionSalary[],
  amounts: readonly bigint[],
  total: bigint,
) => {
  const result = computePeriod(
    period({
      lines: shares.map((netShare, index) =>
        line({ lineId: String.fromCharCode(97 + index), occurredAt: BigInt(index + 1), netShare }),
      ),
      versions: [plan],
      salaries: [...salaries],
    }),
  );
  expect(result).toEqual({
    ok: true,
    perSource: new Map(
      amounts.map((amount, index) => [`line:${String.fromCharCode(97 + index)}`, amount]),
    ),
    total,
  });
};

// بعد 3 أضعاف الراتب 10% على كل المبيعات، وتحتها لا شيء. الأساس مقفول.
const nailsPlan: CommissionPlanVersion = version({
  base: { enabled: false },
  tiers: {
    enabled: true,
    accumulator: 'AMOUNT',
    mode: 'WHOLE',
    steps: [{ from: { kind: 'SALARY_MULTIPLE', value: 300n }, calc: pct(1000n) }],
  },
});

// 20% على الجزء اللي فوق 5,000 بس. الراتب مش داخل الحد لأنه مبلغ حرفي.
const lashPlan: CommissionPlanVersion = version({
  base: { enabled: false },
  tiers: {
    enabled: true,
    accumulator: 'AMOUNT',
    mode: 'MARGINAL',
    steps: [{ from: { kind: 'AMOUNT', value: 5000000n }, calc: pct(2000n) }],
  },
});

// 1% على كل جلسة. الشرائح مقفولة، فالراتب مش شرط للحساب.
const massagePlan: CommissionPlanVersion = version({
  base: { enabled: true, calc: pct(100n) },
  tiers: { enabled: false },
});

const salary600 = salaryOn(600000n);
const salary400 = salaryOn(400000n);
const salary200 = salaryOn(200000n);

describe('D-55 nails specialist — 10% of all sales from 3× salary', () => {
  it("N1 owner's example: 1,200 + 800 = 2,000 ≥ 1,800 → 200.000", () => {
    // 3 × 600 = 1,800. WHOLE وصل للشريحة فيدفع 10% على كل بند: 120.000 + 80.000.
    expectPeriod(nailsPlan, [1200000n, 800000n], [salary600], [120000n, 80000n], 200000n);
  });

  it('N2 below the threshold pays nothing', () => {
    // 1,000 + 700 = 1,700 أقل من 1,800. الشريحة متوصلتش فالاتنين صفر.
    expectPeriod(nailsPlan, [1000000n, 700000n], [salary600], [0n, 0n], 0n);
  });

  it('N3 exactly 3× salary reaches the step', () => {
    // 900 + 900 = 1,800. الشريحة بتتوصل لما from ≤ X: 90.000 + 90.000.
    expectPeriod(nailsPlan, [900000n, 900000n], [salary600], [90000n, 90000n], 180000n);
  });

  it('N4 a package session counts at its slot value', () => {
    // الخدمة 1,500 وجلسة الباقة 400 بـ counts = true: X = 1,900. 10% = 150.000 + 40.000.
    const lines = [
      line({ netShare: 1500000n }),
      line({ lineId: 'b', occurredAt: 2n, netShare: 400000n, counts: true }),
    ];
    expect(computePeriod(period({ lines, versions: [nailsPlan], salaries: [salary600] }))).toEqual({
      ok: true,
      perSource: new Map([
        ['line:a', 150000n],
        ['line:b', 40000n],
      ]),
      total: 190000n,
    });
  });

  it('N5 no salary on record stops the statement', () => {
    // مضاعف الراتب من غير راتب آخر يوم مش نتيجة صفر — الكشف يتوقف.
    expect(
      computePeriod(period({ lines: [line({ netShare: 2000000n })], versions: [nailsPlan] })),
    ).toEqual({ ok: false, code: 'NO_SALARY' });
  });

  it('N6 the plan passes the §5.7 validator', () => {
    expect(validateCommissionPlan(nailsPlan)).toEqual({ ok: true });
  });
});

describe('D-55 lash specialist — 20% above 5,000.000', () => {
  it("L1 owner's example: 4,000 then 2,000 → 200.000 on the part above 5,000", () => {
    // 0→4,000 تحت الحد: صفر. 4,000→6,000 بيعدّي الحد: 1,000 × 20% = 200.000.
    expectPeriod(lashPlan, [4000000n, 2000000n], [salary400], [0n, 200000n], 200000n);
  });

  it('L2 below 5,000 pays nothing', () => {
    // 3,000 + 1,500 = 4,500 تحت 5,000. الاتنين صفر.
    expectPeriod(lashPlan, [3000000n, 1500000n], [salary400], [0n, 0n], 0n);
  });

  it('L3 a line that starts exactly at 5,000 pays on all of it', () => {
    // البند الأول بيقف عند 5,000 ومبيلامسش الشريحة. التاني: 500 × 20% = 100.000.
    expectPeriod(lashPlan, [5000000n, 500000n], [salary400], [0n, 100000n], 100000n);
  });

  it('L4 no salary on record still pays a literal threshold', () => {
    // الحد مبلغ حرفي، فغياب الراتب مش NO_SALARY. نفس مثال المالك: 200.000.
    expectPeriod(lashPlan, [4000000n, 2000000n], [], [0n, 200000n], 200000n);
  });

  it('L5 the plan passes the §5.7 validator', () => {
    expect(validateCommissionPlan(lashPlan)).toEqual({ ok: true });
  });
});

describe('D-55 massage therapist — 1% of every session', () => {
  it('M1 150.000 and 50.500 → 1.500 and 0.505', () => {
    // 150.000 × 1% = 1.500 و 50.500 × 1% = 0.505. المجموع 2.005.
    expectPeriod(massagePlan, [150000n, 50500n], [salary200], [1500n, 505n], 2005n);
  });

  it('M2 a discount is already taken out of netShare', () => {
    // خدمة 20.000 بخصم 5.000 بتوصل netShare 15.000. 15.000 × 1% = 0.150.
    expectPeriod(massagePlan, [15000n], [salary200], [150n], 150n);
  });

  it('M3 rounds each line to the nearest mill, and an exact half away from zero', () => {
    // 12.345 × 1% = 123.45 فلس → 123. و 0.050 × 1% = 0.5 فلس بالظبط → 1.
    expectPeriod(massagePlan, [12345n, 50n], [salary200], [123n, 1n], 124n);
  });

  it('M4 a shared session pays 1% of her half', () => {
    // صافي 200.000 اتقسم 50/50 قبل المحرك: netShare 100.000 و shareBps 5000. 100.000 × 1% = 1.000.
    expect(
      computePeriod(
        period({
          lines: [line({ netShare: 100000n, shareBps: 5000n })],
          versions: [massagePlan],
          salaries: [salary200],
        }),
      ),
    ).toEqual({ ok: true, perSource: new Map([['line:a', 1000n]]), total: 1000n });
  });

  it('M5 no salary on record still pays the base', () => {
    // الأساس مش مضاعف راتب. 150.000 × 1% = 1.500 من غير راتب.
    expectPeriod(massagePlan, [150000n], [], [1500n], 1500n);
  });

  it('M6 the plan passes the §5.7 validator', () => {
    expect(validateCommissionPlan(massagePlan)).toEqual({ ok: true });
  });
});
