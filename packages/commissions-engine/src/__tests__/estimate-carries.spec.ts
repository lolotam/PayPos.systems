import { describe, expect, it } from 'vitest';

import { projectCommissionEstimate } from '../estimate-projection.ts';
import type {
  CommissionEstimateLine,
  CommissionEstimateMonthRows,
  CommissionEstimateProjectionInput,
} from '../estimate-projection-types.ts';
import type { IncomingCommissionCarry } from '../period-input-types.ts';

const EMPLOYEE = 'employee-sara';
const BRANCH = 'branch-salmiya';
const PERIOD = '2026-11';

/** بند بنسبة ثابتة عشرة بالمئة على مئة دينار: عمولته عشرة دنانير من غير خطة. */
const LINE: CommissionEstimateLine = {
  employeeId: EMPLOYEE,
  serviceId: 'service-a',
  lineId: 'line-a',
  occurredAt: 1n,
  recordedAt: 1n,
  businessDate: '2026-11-05',
  netShare: 100_000n,
  shareBps: 10_000n,
  counts: true,
  ruleSnapshot: { kind: 'PCT', value: 1_000n },
  status: 'ACTIVE',
  branchId: BRANCH,
};

function carry(patch: Partial<IncomingCommissionCarry> = {}): IncomingCommissionCarry {
  return {
    employeeId: EMPLOYEE,
    kind: 'COMMISSION',
    amount: -5_000n,
    sourceStatementId: 'statement-oct',
    sourcePeriod: '2026-10',
    targetPeriod: PERIOD,
    ...patch,
  };
}

const BOTH_CARRIES = [carry(), carry({ kind: 'TIP_CARD', amount: -2_000n })];

function month(patch: Partial<CommissionEstimateMonthRows> = {}): CommissionEstimateMonthRows {
  return {
    lines: [LINE],
    sales: [],
    tips: [],
    salaries: [],
    versions: [],
    overrides: [],
    corrections: [],
    carries: BOTH_CARRIES,
    ...patch,
  };
}

function input(
  patch: Partial<CommissionEstimateProjectionInput> = {},
): CommissionEstimateProjectionInput {
  return {
    scope: { businessWide: true, branchIds: [] },
    period: PERIOD,
    employeeIds: [EMPLOYEE],
    month: month(),
    attachments: [{ employeeId: EMPLOYEE, branchId: BRANCH, from: '2026-01-01', to: null }],
    ...patch,
  };
}

const branchScope = { businessWide: false, branchIds: [BRANCH] };

describe('the incoming carries in the estimate (D-22, BR-06)', () => {
  it('shows a business-wide reader both carries, each on its own and never netted', () => {
    const [employee] = projectCommissionEstimate(input()).employees;
    expect(employee?.carries).toEqual({ commission: -5_000n, tipCard: -2_000n });
  });

  it('leaves the priced total to the sources: a carry is passed through, not added to it', () => {
    const projection = projectCommissionEstimate(input());
    expect(projection.employees[0]?.total).toBe(10_000n);
    expect(projection.total).toBe(10_000n);
  });

  it('adds up several carries of the same kind from different source months, per kind', () => {
    const more = carry({
      sourceStatementId: 'statement-sep',
      sourcePeriod: '2026-09',
      amount: -1_000n,
    });
    const [employee] = projectCommissionEstimate(
      input({ month: month({ carries: [...BOTH_CARRIES, more] }) }),
    ).employees;
    expect(employee?.carries).toEqual({ commission: -6_000n, tipCard: -2_000n });
  });
});

describe('the incoming carries for a branch-scoped reader and edge cases', () => {
  it('shows a branch-scoped reader no carry and labels her figures partial, because a carry has no branch', () => {
    const [employee] = projectCommissionEstimate(input({ scope: branchScope })).employees;
    expect(employee?.carries).toEqual({ commission: 0n, tipCard: 0n });
    expect(employee?.partial).toBe(true);
  });

  it('keeps her figures whole when there is no carry', () => {
    const [employee] = projectCommissionEstimate(
      input({ scope: branchScope, month: month({ carries: [] }) }),
    ).employees;
    expect(employee?.partial).toBe(false);
  });

  it('ignores a carry aimed at another month or another employee', () => {
    const foreign = [carry({ targetPeriod: '2026-12' }), carry({ employeeId: 'employee-other' })];
    const [employee] = projectCommissionEstimate(
      input({ month: month({ carries: foreign }) }),
    ).employees;
    expect(employee?.carries).toEqual({ commission: 0n, tipCard: 0n });
  });

  it('lists an employee who has only a carry for a business-wide reader, with a zero total', () => {
    const only = projectCommissionEstimate(input({ month: month({ lines: [] }) }));
    expect(only.employees).toHaveLength(1);
    expect(only.employees[0]).toMatchObject({
      total: 0n,
      carries: { commission: -5_000n, tipCard: -2_000n },
    });
  });

  it('does not make a carry alone a reason to show an employee to a branch-scoped reader', () => {
    const none = projectCommissionEstimate(
      input({ scope: branchScope, month: month({ lines: [] }), attachments: [] }),
    );
    expect(none.employees).toEqual([]);
  });

  it('still shows the carries of a month the engine could not price', () => {
    const unpriced = { ...LINE, ruleSnapshot: { kind: 'FOLLOW_PLAN' as const } };
    const [employee] = projectCommissionEstimate(
      input({ month: month({ lines: [unpriced] }) }),
    ).employees;
    expect(employee).toMatchObject({
      status: 'NO_PLAN',
      total: null,
      carries: { commission: -5_000n, tipCard: -2_000n },
    });
  });

  it('works for callers that read no carries at all', () => {
    const base = month();
    const rest: CommissionEstimateMonthRows = {
      lines: base.lines,
      sales: base.sales,
      tips: base.tips,
      salaries: base.salaries,
      versions: base.versions,
      overrides: base.overrides,
      corrections: base.corrections,
    };
    const [employee] = projectCommissionEstimate(input({ month: rest })).employees;
    expect(employee?.carries).toEqual({ commission: 0n, tipCard: 0n });
  });
});
