import { describe, expect, it } from 'vitest';

import type { CommissionComponent } from '../plan-types.ts';
import { computePeriod, computePeriodDetailed } from '../period-commission.ts';
import { period, sale, version } from './engine-ii-fixtures.ts';

/** خطة بحد راتب مضاعف وبقاعدة بيع باقة اختيارية؛ حدودها محتاجة راتب. */
function salaryPlan(patch: { readonly packageSale?: CommissionComponent } = {}) {
  return version({
    tiers: {
      enabled: true,
      mode: 'MARGINAL',
      accumulator: 'AMOUNT',
      steps: [{ from: { kind: 'SALARY_MULTIPLE', value: 200n }, calc: { kind: 'PCT', value: 500n } }],
    },
    packageSale: patch.packageSale ?? { enabled: true, calc: { kind: 'PCT', value: 1000n } },
  });
}

describe('a sale-only month without a salary', () => {
  it('prices the sale even though the service tiers need a salary', () => {
    const result = computePeriod(
      period({ sales: [sale({ pricePaid: 30000n })], versions: [salaryPlan()] }),
    );

    expect(result).toEqual({ ok: true, perSource: new Map([['sale:sale-a', 3000n]]), total: 3000n });
  });

  it('pays zero when the package sale rule is disabled', () => {
    const result = computePeriod(
      period({
        sales: [sale({ pricePaid: 30000n })],
        versions: [salaryPlan({ packageSale: { enabled: false } })],
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

  it('reports the failure against its own source', () => {
    const detailed = computePeriodDetailed(
      period({ sales: [sale({ pricePaid: 30000n })], versions: [] }),
    );

    expect(detailed.failures).toEqual([{ sourceRef: 'sale:sale-a', code: 'NO_PLAN' }]);
    expect(detailed.perSource.size).toBe(0);
  });
});
