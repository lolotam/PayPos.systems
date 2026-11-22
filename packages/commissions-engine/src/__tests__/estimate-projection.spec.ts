import { describe, expect, it } from 'vitest';

import {
  projectCommissionEstimate,
  type CommissionEstimateAttachment,
  type CommissionEstimateLine,
  type CommissionEstimateMonthRows,
  type CommissionEstimateProjectionInput,
} from '../estimate-projection.ts';
import type { CommissionPlanVersion } from '../plan-types.ts';

const EMPLOYEE = '01920000-0000-7000-8000-0000000000e1';
const OTHER = '01920000-0000-7000-8000-0000000000e2';
const BRANCH_A = '01920000-0000-7000-8000-0000000000c1';
const BRANCH_B = '01920000-0000-7000-8000-0000000000c2';
const PERIOD = '2026-11';

/** بند بنسبة ثابتة: بيتسعّر من غير خطة، ففشله مش من نوع غياب الخطة. */
function fixedLine(patch: Partial<CommissionEstimateLine> = {}): CommissionEstimateLine {
  return {
    employeeId: EMPLOYEE,
    serviceId: 'service-a',
    lineId: 'line-a',
    occurredAt: 1n,
    recordedAt: 1n,
    businessDate: '2026-11-05',
    netShare: 100000n,
    shareBps: 10000n,
    counts: true,
    ruleSnapshot: { kind: 'PCT', value: 1000n },
    status: 'ACTIVE',
    branchId: BRANCH_A,
    ...patch,
  };
}

/** بند بيتبع الخطة: من غير خطة سارية بيفشل تسعيره بـ NO_PLAN. */
function planLine(patch: Partial<CommissionEstimateLine> = {}): CommissionEstimateLine {
  return fixedLine({ lineId: 'line-plan', ruleSnapshot: { kind: 'FOLLOW_PLAN' }, ...patch });
}

/** خطة بنسبة عشرة بالمئة بلا شرائح ولا بيع باقة. */
function plan(employeeId = EMPLOYEE): CommissionPlanVersion {
  return {
    employeeId,
    effectiveFrom: '2026-11-01',
    wholePeriod: false,
    repairPeriod: null,
    createdAt: 1n,
    version: 1n,
    base: { enabled: false },
    tiers: { enabled: false },
    packageSale: { enabled: false },
  };
}

function attachment(patch: Partial<CommissionEstimateAttachment> = {}): CommissionEstimateAttachment {
  return {
    employeeId: EMPLOYEE,
    branchId: BRANCH_A,
    from: '2026-11-01',
    to: null,
    ...patch,
  };
}

/** ارتباطات الموظفة: أول نصف الشهر في الفرع الأول وباقيته في الفرع التاني. */
function transferredAttachments(): readonly CommissionEstimateAttachment[] {
  return [attachment({ to: '2026-11-15' }), attachment({ branchId: BRANCH_B, from: '2026-11-15' })];
}

function month(patch: Partial<CommissionEstimateMonthRows> = {}): CommissionEstimateMonthRows {
  return {
    lines: [],
    sales: [],
    tips: [],
    salaries: [],
    versions: [],
    overrides: [],
    corrections: [],
    ...patch,
  };
}

function projection(
  patch: Partial<CommissionEstimateProjectionInput> = {},
): CommissionEstimateProjectionInput {
  return {
    scope: { businessWide: false, branchIds: [BRANCH_A] },
    period: PERIOD,
    employeeIds: [EMPLOYEE],
    month: month(),
    attachments: [],
    ...patch,
  };
}

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

    expect(result.employees[0]?.sources.map((source) => source.sourceRef)).toEqual([
      'line:line-a',
    ]);
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
    expect(result.employees[0]?.sources.map((source) => source.sourceRef)).toEqual([
      'line:line-a',
    ]);
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
