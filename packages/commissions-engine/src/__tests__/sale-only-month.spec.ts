import { describe, expect, it } from 'vitest';

import { computePeriod, computePeriodDetailed } from '../period-commission.ts';
import { period, sale, version } from './engine-ii-fixtures.ts';

/** خطة بحد راتب مضاعف وبقاعدة بيع باقة اختيارية؛ حدودها محتاجة راتب (D-57). */
function salaryPlan(patch: { readonly packageSale?: boolean } = {}) {
  return version({
    tiers: {
      enabled: true,
      mode: 'MARGINAL',
      accumulator: 'AMOUNT',
      steps: [{ from: { kind: 'SALARY_MULTIPLE', value: 200n }, calc: { kind: 'PCT', value: 500n } }],
    },
    packageSale: { enabled: patch.packageSale ?? true, calc: { kind: 'PCT', value: 1000n } },
  });
}

describe('a sale-only month under a salary-multiple plan', () => {
  it('refuses the month when the salary is missing, and names the sale', () => {
    // D-57 (SPEC §5، 012 requirement 6): خطة مختارة بحدود راتب مضاعف بتحتاج
    // راتب حتى لو المصدر بيع.
    const result = computePeriod(
      period({ sales: [sale({ pricePaid: 30000n })], versions: [salaryPlan()] }),
    );

    expect(result).toEqual({ ok: false, code: 'NO_SALARY' });
  });

  it('reports the refusal against the sale source for the estimate filter', () => {
    const detailed = computePeriodDetailed(
      period({ sales: [sale({ pricePaid: 30000n })], versions: [salaryPlan()] }),
    );

    expect(detailed.failures).toEqual([{ sourceRef: 'sale:sale-a', code: 'NO_SALARY' }]);
    expect(detailed.perSource.size).toBe(0);
  });
});

describe('a sale-only month under a salary-multiple plan with a salary', () => {
  const salaries = [{ employeeId: 'employee-a', effectiveFrom: '2026-10-01', amount: 500000n }];

  it('prices the sale', () => {
    const result = computePeriod(
      period({
        sales: [sale({ pricePaid: 30000n, refundedAmount: 10000n })],
        versions: [salaryPlan()],
        salaries,
      }),
    );

    expect(result).toEqual({ ok: true, perSource: new Map([['sale:sale-a', 2000n]]), total: 2000n });
  });

  it('pays zero for a disabled package rule', () => {
    const result = computePeriod(
      period({
        sales: [sale({ pricePaid: 30000n })],
        versions: [salaryPlan({ packageSale: false })],
        salaries,
      }),
    );

    expect(result).toEqual({ ok: true, perSource: new Map([['sale:sale-a', 0n]]), total: 0n });
  });

  it('keeps the missing plan a failure even for a free sale', () => {
    const result = computePeriod(period({ sales: [sale({ pricePaid: 0n })], versions: [] }));

    expect(result).toEqual({ ok: false, code: 'NO_PLAN' });
  });

  it('keeps the service line without a salary a failure', () => {
    const result = computePeriod(
      period({
        lines: [
          {
            employeeId: 'employee-a',
            serviceId: 'service-a',
            lineId: 'a',
            occurredAt: 1n,
            recordedAt: 1n,
            businessDate: '2026-10-10',
            netShare: 100000n,
            shareBps: 10000n,
            counts: true,
            ruleSnapshot: { kind: 'FOLLOW_PLAN' },
          },
        ],
        versions: [salaryPlan()],
      }),
    );

    expect(result).toEqual({ ok: false, code: 'NO_SALARY' });
  });
});
