import { describe, expect, it } from 'vitest';

import { computePeriod } from '../period-commission.ts';
import type { CommissionPlanVersion, CommissionSalary } from '../plan-types.ts';
import { line, pct, period, version } from './engine-ii-fixtures.ts';

// D-55 — خطة الصالون الفعلية (2026-10-05): لما الموظفة تعدّي ضعف راتبها
// تاخد 5% على اللي فوق الحد بس، ومفيش نسبة أساسية. الأرقام محسوبة باليد.
const salonPlan: CommissionPlanVersion = version({
  base: { enabled: false },
  tiers: {
    enabled: true,
    accumulator: 'AMOUNT',
    mode: 'MARGINAL',
    steps: [{ from: { kind: 'SALARY_MULTIPLE', value: 200n }, calc: pct(500n) }],
  },
});

const salary500: CommissionSalary = {
  employeeId: 'employee-a',
  effectiveFrom: '2026-01-01',
  amount: 500000n,
};

const lines = (shares: readonly bigint[]) =>
  shares.map((netShare, index) =>
    line({ lineId: String.fromCharCode(97 + index), occurredAt: BigInt(index + 1), netShare }),
  );

const expectPeriod = (
  shares: readonly bigint[],
  salaries: readonly CommissionSalary[],
  amounts: readonly bigint[],
  total: bigint,
) => {
  const result = computePeriod(
    period({ lines: lines(shares), versions: [salonPlan], salaries: [...salaries] }),
  );
  expect(result).toEqual({
    ok: true,
    perSource: new Map(
      amounts.map((amount, index) => [`line:${String.fromCharCode(97 + index)}`, amount]),
    ),
    total,
  });
};

describe('D-55 real salon plan — 5% above twice the salary', () => {
  it("owner's example: salary 500.000, sales 2,000.000 → 50.000", () => {
    // الحد 2 × 500 = 1,000. البند الأول 0→600 تحت الحد: صفر.
    // التاني 600→1,200 بيعدّي الحد: 200 × 5% = 10.000. التالت 1,200→2,000: 800 × 5% = 40.000.
    expectPeriod([600000n, 600000n, 800000n], [salary500], [0n, 10000n, 40000n], 50000n);
  });

  it('sales that only reach the threshold pay nothing', () => {
    // 400 + 600 = 1,000 بالظبط؛ البند التاني بيقف عند الحد ومبيلمسش الشريحة.
    expectPeriod([400000n, 600000n], [salary500], [0n, 0n], 0n);
  });

  it('a line that starts exactly at the threshold pays on all of it', () => {
    // البند التاني بيبدأ عند 1,000: 100 × 5% = 5.000.
    expectPeriod([1000000n, 100000n], [salary500], [0n, 5000n], 5000n);
  });

  it('half a mill above the threshold rounds away from zero', () => {
    // 0.555 × 5% = 0.02775 دينار = 27.75 فلس → 28 فلس.
    expectPeriod([1000000n, 555n], [salary500], [0n, 28n], 28n);
  });

  it('a raise during the month moves the threshold to the last-day salary', () => {
    // راتب آخر يوم 600 → الحد 1,200. البيع 2,000: (2,000 − 1,200) × 5% = 40.000 كلها على البند التاني.
    const raise: CommissionSalary = { ...salary500, effectiveFrom: '2026-10-20', amount: 600000n };
    expectPeriod([1000000n, 1000000n], [salary500, raise], [0n, 40000n], 40000n);
  });

  it('no salary on record stops the statement instead of paying zero', () => {
    const result = computePeriod(period({ lines: lines([2000000n]), versions: [salonPlan] }));
    expect(result).toMatchObject({ ok: false, code: 'NO_SALARY' });
  });
});
