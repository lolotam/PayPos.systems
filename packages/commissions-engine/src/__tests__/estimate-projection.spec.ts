import { describe, expect, it } from 'vitest';

import { projectCommissionEstimate } from '../estimate-projection.ts';
import type { CommissionEstimateMonthRows } from '../estimate-projection-types.ts';
import type { CommissionPlanVersion } from '../plan-types.ts';
import {
  attachment,
  BRANCH_A,
  BRANCH_B,
  correction,
  EMPLOYEE,
  fixedLine,
  month,
  OTHER,
  plan,
  planLine,
  projection,
  tip,
  transferredAttachments,
} from './estimate-projection-fixtures.ts';

describe('the visible rows of the estimate', () => {
  it('shows the visible source to a branch-scoped reader and marks the aggregate partial', () => {
    const result = projectCommissionEstimate(
      projection({
        month: month({ lines: [fixedLine()], versions: [plan()] }),
        attachments: [attachment()],
      }),
    );

    expect(result.employees).toHaveLength(1);
    expect(result.employees[0]?.total).toBe(10000n);
    expect(result.employees[0]?.partial).toBe(false);
    expect(result.total).toBe(10000n);
    // القارئ على مستوى الفروع بيشوف مجموع جزئي من النشاط كله (CM-23g).
    expect(result.partial).toBe(true);
  });

  it('leaves a source of another branch out of the visible total', () => {
    const result = projectCommissionEstimate(
      projection({
        month: month({
          lines: [
            fixedLine(),
            fixedLine({ lineId: 'line-b', businessDate: '2026-11-20', branchId: BRANCH_B }),
          ],
          versions: [plan()],
        }),
        attachments: transferredAttachments(),
      }),
    );

    expect(result.employees[0]?.sources.map((source) => source.sourceRef)).toEqual(['line:line-a']);
    expect(result.employees[0]?.total).toBe(10000n);
    expect(result.employees[0]?.partial).toBe(true);
  });

  it('shows the whole month to a business-wide reader', () => {
    const result = projectCommissionEstimate(
      projection({
        scope: { businessWide: true, branchIds: [BRANCH_A, BRANCH_B] },
        employeeIds: [EMPLOYEE, OTHER],
        month: month({
          lines: [
            fixedLine(),
            fixedLine({ lineId: 'line-b', businessDate: '2026-11-20', branchId: BRANCH_B }),
          ],
          versions: [plan()],
        }),
        attachments: transferredAttachments(),
      }),
    );

    expect(result.employees[0]?.total).toBe(20000n);
    expect(result.employees[0]?.partial).toBe(false);
    expect(result.total).toBe(20000n);
    expect(result.partial).toBe(false);
  });
});

describe('the pricing failures of the estimate', () => {
  it('keeps the visible amount when a hidden source misses its plan', () => {
    const result = projectCommissionEstimate(
      projection({
        month: month({
          lines: [fixedLine(), planLine({ businessDate: '2026-11-20', branchId: BRANCH_B })],
          versions: [],
        }),
        attachments: transferredAttachments(),
      }),
    );

    // فشل المصدر المخفي ما بيسقطش المصدر الظاهر وولا بيفضح سبب ما القارئ
    // شايفهوش (CM-23).
    expect(result.employees[0]?.status).toBe('OK');
    expect(result.employees[0]?.total).toBe(10000n);
    expect(result.employees[0]?.sources.map((source) => source.sourceRef)).toEqual(['line:line-a']);
  });

  it('refuses the month when a visible source misses its plan', () => {
    const result = projectCommissionEstimate(
      projection({
        month: month({ lines: [fixedLine(), planLine()], versions: [] }),
        attachments: [attachment()],
      }),
    );

    expect(result.employees[0]?.status).toBe('NO_PLAN');
    expect(result.employees[0]?.total).toBeNull();
    expect(result.employees[0]?.sources).toEqual([]);
    expect(result.total).toBeNull();
  });
});

describe('the refused month of the estimate', () => {
  it('keeps only the visible tips and corrections of a refused month', () => {
    // البقشيش والتصحيح بيعدّوا من غير تسعير (D-1)، فرفض التسعير ما بيمسحهمش،
    // واللي على الفرع التاني يفضل مخفي عن قارئ الفرع الأول (CS-Q20).
    const result = projectCommissionEstimate(
      projection({
        month: month({
          lines: [planLine()],
          tips: [tip(), tip({ sessionId: 'tip-b', businessDate: '2026-11-20', method: 'CASH' })],
          corrections: [
            correction(),
            correction({ sourceRef: 'line:old-b', attachedBranchIds: [BRANCH_B], amount: 3000n }),
          ],
        }),
        attachments: transferredAttachments(),
      }),
    );

    expect(result.employees[0]?.status).toBe('NO_PLAN');
    expect(result.employees[0]?.total).toBeNull();
    expect(result.employees[0]?.tips).toEqual({ card: 2500n, cash: 0n });
    expect(result.employees[0]?.corrections.map((row) => row.sourceRef)).toEqual(['line:old-a']);
    expect(result.employees[0]?.partial).toBe(true);
  });

  it('does not label a refused month partial when the reader sees all of it', () => {
    const result = projectCommissionEstimate(
      projection({
        month: month({ lines: [planLine()], tips: [tip()], corrections: [correction()] }),
        attachments: [attachment()],
      }),
    );

    expect(result.employees[0]?.status).toBe('NO_PLAN');
    expect(result.employees[0]?.partial).toBe(false);
    expect(result.employees[0]?.tips).toEqual({ card: 2500n, cash: 0n });
  });
});

describe('the candidates of the estimate', () => {
  it('shows a real zero for an attached employee without work', () => {
    const result = projectCommissionEstimate(projection({ attachments: [attachment()] }));

    expect(result.employees).toHaveLength(1);
    expect(result.employees[0]?.status).toBe('OK');
    expect(result.employees[0]?.total).toBe(0n);
    expect(result.employees[0]?.partial).toBe(false);
  });

  it('hides an employee attached only to another branch', () => {
    const result = projectCommissionEstimate(
      projection({
        employeeIds: [OTHER],
        attachments: [attachment({ employeeId: OTHER, branchId: BRANCH_B })],
      }),
    );

    expect(result.employees).toEqual([]);
    expect(result.total).toBe(0n);
  });

  it('hides an employee without a name row', () => {
    const result = projectCommissionEstimate(
      projection({
        employeeIds: [],
        month: month({ lines: [fixedLine()], versions: [plan()] }),
        attachments: [attachment()],
      }),
    );

    expect(result.employees).toEqual([]);
  });
});

describe('the configuration rows of the estimate', () => {
  it.each<[string, Partial<CommissionEstimateMonthRows>]>([
    ['salary', { salaries: [{ employeeId: OTHER, effectiveFrom: '2026-11-01', amount: 500000n }] }],
    ['plan', { versions: [plan(OTHER)] }],
    [
      'override',
      {
        overrides: [
          {
            id: 'override-a',
            employeeId: OTHER,
            serviceId: 'service-a',
            effectiveFrom: '2026-11-01',
            createdAt: 1n,
            rule: { kind: 'PCT', value: 1000n },
          },
        ],
      },
    ],
  ])('does not add a result for a %s row alone', (_name, rows) => {
    // قارئ النشاط كله بيشوف كل مرشحة، فالصف ده لو زوّد مرشحة كانت هتظهر بصفر.
    const result = projectCommissionEstimate(
      projection({
        scope: { businessWide: true, branchIds: [] },
        employeeIds: [OTHER],
        month: month(rows),
      }),
    );

    expect(result.employees).toEqual([]);
  });
});

describe('an out-of-month row of an unattached employee', () => {
  it('does not make a business-wide reader see a tip of another month', () => {
    // البقشاش بيعدّ من غير تسعير (D-1)، فلو صف شهر تاني كان بيعمل مرشحة كانت
    // هتظهر للقارئ على مستوى النشاط بصفر.
    const result = projectCommissionEstimate(
      projection({
        scope: { businessWide: true, branchIds: [] },
        employeeIds: [OTHER],
        month: month({ tips: [tip({ employeeId: OTHER, businessDate: '2026-10-05' })] }),
      }),
    );

    expect(result.employees).toEqual([]);
  });

  it('does not make a business-wide reader see a correction of another month', () => {
    const result = projectCommissionEstimate(
      projection({
        scope: { businessWide: true, branchIds: [] },
        employeeIds: [OTHER],
        month: month({ corrections: [correction({ employeeId: OTHER, targetPeriod: '2026-10' })] }),
      }),
    );

    expect(result.employees).toEqual([]);
  });
});

describe('the correction-only candidate of the estimate', () => {
  it('shows a departed employee who only received a visible correction', () => {
    // موظفة ارتباطها خلص قبل الشهر ولسه مستلمة تصحيح على فرع القارئ: بتظهر
    // بصف التصحيح من غير أي عمل في الشهر (FR-040).
    const result = projectCommissionEstimate(
      projection({
        month: month({ corrections: [correction()] }),
        attachments: [attachment({ to: '2026-10-31' })],
      }),
    );

    expect(result.employees).toHaveLength(1);
    expect(result.employees[0]?.total).toBe(0n);
    expect(result.employees[0]?.corrections.map((row) => row.amount)).toEqual([5000n]);
  });
});

describe('the covered days of the estimate', () => {
  it('covers a whole month clipped from an attachment ending after it', () => {
    // الارتباط نصف مفتوح وبيتقصّ على الشهر: نهاية في سنة بعديّة بتغطي باقي
    // الشهر كله، فصف الموظفة ما بيتعلّمش جزئي (CS-Q23).
    const result = projectCommissionEstimate(
      projection({
        month: month({ lines: [fixedLine()], versions: [plan()] }),
        attachments: [attachment({ to: '2027-03-01' })],
      }),
    );

    expect(result.employees[0]?.partial).toBe(false);
    expect(result.employees[0]?.total).toBe(10000n);
  });

  it('covers December of the last four-digit year for an open attachment', () => {
    const result = projectCommissionEstimate(
      projection({
        period: '9999-12',
        attachments: [attachment({ from: '9999-12-01' })],
      }),
    );

    expect(result.employees).toHaveLength(1);
    expect(result.employees[0]?.partial).toBe(false);
  });

  it('covers nothing for an attachment that ended before the month', () => {
    const result = projectCommissionEstimate(
      projection({
        month: month({ lines: [fixedLine()], versions: [plan()] }),
        attachments: [attachment({ to: '2026-10-31' })],
      }),
    );

    expect(result.employees).toEqual([]);
  });

  it('covers nothing for an attachment that starts after the month', () => {
    const result = projectCommissionEstimate(
      projection({
        month: month({ lines: [fixedLine()], versions: [plan()] }),
        attachments: [attachment({ from: '2026-12-01' })],
      }),
    );

    expect(result.employees).toEqual([]);
  });
});

describe('the sale under a salary-multiple plan', () => {
  /** خطة بحد راتب مضاعف وقاعدة بيع باقة بنسبة عشرة بالمئة (D-57). */
  function salaryPlan(): CommissionPlanVersion {
    return {
      ...plan(),
      tiers: {
        enabled: true,
        mode: 'MARGINAL',
        accumulator: 'AMOUNT',
        steps: [
          { from: { kind: 'SALARY_MULTIPLE', value: 200n }, calc: { kind: 'PCT', value: 500n } },
        ],
      },
      packageSale: { enabled: true, calc: { kind: 'PCT', value: 1000n } },
    };
  }

  function saleMonth(salaries: CommissionEstimateMonthRows['salaries']) {
    return month({
      sales: [
        {
          saleId: 'sale-a',
          sellerEmployeeId: EMPLOYEE,
          businessDate: '2026-11-05',
          pricePaid: 30000n,
          refundedAmount: 10000n,
          status: 'ACTIVE',
          branchId: BRANCH_A,
        },
      ],
      versions: [salaryPlan()],
      salaries,
    });
  }

  const salary = [{ employeeId: EMPLOYEE, effectiveFrom: '2026-11-01', amount: 500000n }];

  it('refuses a sale-only month whose salary-multiple plan has no salary', () => {
    // D-57 (SPEC §5، 012 requirement 6): حتى لو المصدر بيع، الخطة المختارة
    // بحدود راتب مضاعف بتحتاج راتب.
    const result = projectCommissionEstimate(
      projection({ scope: { businessWide: true, branchIds: [BRANCH_A] }, month: saleMonth([]) }),
    );

    expect(result.employees[0]?.status).toBe('NO_SALARY');
    expect(result.employees[0]?.total).toBeNull();
    expect(result.total).toBeNull();
  });

  it('prices the sale when the salary exists', () => {
    const result = projectCommissionEstimate(
      projection({
        scope: { businessWide: true, branchIds: [BRANCH_A] },
        month: saleMonth(salary),
      }),
    );

    expect(result.employees[0]?.status).toBe('OK');
    expect(result.employees[0]?.total).toBe(2000n);
    expect(result.total).toBe(2000n);
  });
});
