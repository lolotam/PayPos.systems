import { describe, expect, it } from 'vitest';

import type {
  CommissionEstimateAttachment,
  CommissionEstimateEmployee,
  CommissionEstimateLine,
  CommissionEstimateMonthRows,
  CommissionEstimateReadResult,
  CommissionEstimateSale,
} from '../../ports/commission-estimate.port.ts';
import { buildCommissionEstimate } from './estimate-assembly.ts';

const EMPLOYEE = '01920000-0000-7000-8000-0000000000e1';
const OTHER = '01920000-0000-7000-8000-0000000000e2';
const BRANCH_A = '01920000-0000-7000-8000-0000000000c1';
const BRANCH_B = '01920000-0000-7000-8000-0000000000c2';

const names: CommissionEstimateEmployee[] = [
  { employeeId: EMPLOYEE, nameAr: 'سارة', nameEn: 'Sarah', employeeNumber: 1 },
  { employeeId: OTHER, nameAr: null, nameEn: 'Nadia', employeeNumber: 2 },
];

const line = (
  employeeId: string,
  lineId: string,
  businessDate: string,
  branchId = BRANCH_A,
): CommissionEstimateLine => ({
  employeeId,
  serviceId: '01920000-0000-7000-8000-0000000000d1',
  branchId,
  lineId,
  occurredAt: 0n,
  recordedAt: 0n,
  businessDate,
  netShare: 10000n,
  shareBps: 10000n,
  counts: true,
  ruleSnapshot: { kind: 'PCT', value: 1000n },
  status: 'ACTIVE',
});

const sale = (
  employeeId: string,
  saleId: string,
  businessDate: string,
  branchId = BRANCH_A,
): CommissionEstimateSale => ({
  saleId,
  sellerEmployeeId: employeeId,
  branchId,
  businessDate,
  pricePaid: 30000n,
  refundedAmount: 0n,
  status: 'ACTIVE',
});

const attachment = (
  employeeId: string,
  branchId: string,
  from: string,
  to: string | null,
): CommissionEstimateAttachment => ({ employeeId, branchId, from, to });

const emptyMonth: CommissionEstimateMonthRows = {
  lines: [],
  sales: [],
  tips: [],
  salaries: [],
  versions: [],
  overrides: [],
  corrections: [],
};

const inputs = (overrides: Partial<CommissionEstimateReadResult> = {}): CommissionEstimateReadResult => ({
  businessWide: true,
  branchIds: [],
  employees: names,
  attachments: [],
  month: emptyMonth,
  ...overrides,
});

const request = {
  companyId: '01920000-0000-7000-8000-0000000000a0',
  userId: '01920000-0000-7000-8000-0000000000a1',
  businessId: '01920000-0000-7000-8000-0000000000b1',
  period: '2026-10',
  employeeId: null,
};

describe('buildCommissionEstimate for a business-wide reader', () => {
  it('prices a whole month and shows every employee', () => {
    const estimate = buildCommissionEstimate(
      inputs({
        month: {
          ...emptyMonth,
          lines: [line(EMPLOYEE, 'line-1', '2026-10-05'), line(OTHER, 'line-2', '2026-10-06')],
        },
      }),
      request,
    );

    expect(estimate.employees.map((employee) => employee.employee_id)).toEqual([
      EMPLOYEE,
      OTHER,
    ]);
    expect(estimate.employees[0]).toMatchObject({ status: 'OK', total: '1.000', partial: false });
    expect(estimate.total).toBe('2.000');
  });

  it('prices an active sale with the engine amount', () => {
    const estimate = buildCommissionEstimate(
      inputs({
        month: {
          ...emptyMonth,
          sales: [sale(EMPLOYEE, 'sale-1', '2026-10-05')],
          versions: [
            {
              employeeId: EMPLOYEE,
              effectiveFrom: '2026-10-01',
              wholePeriod: false,
              repairPeriod: null,
              createdAt: 0n,
              version: 1n,
              base: { enabled: false },
              tiers: { enabled: false },
              packageSale: { enabled: true, calc: { kind: 'PCT', value: 1000n } },
            },
          ],
        },
      }),
      request,
    );

    expect(estimate.employees[0]?.status).toBe('OK');
    expect(estimate.employees[0]?.total).toBe('3.000');
    expect(estimate.employees[0]?.sales).toEqual([
      {
        sale_id: 'sale-1',
        amount: '3.000',
        source_branch_id: BRANCH_A,
        source_business_date: '2026-10-05',
      },
    ]);
  });
});

describe('buildCommissionEstimate for a branch reader', () => {
  it('shows only the days she was attached to her branch', () => {
    const estimate = buildCommissionEstimate(
      inputs({
        businessWide: false,
        branchIds: [BRANCH_A],
        attachments: [
          attachment(EMPLOYEE, BRANCH_A, '2026-10-01', '2026-10-15'),
          attachment(EMPLOYEE, BRANCH_B, '2026-10-16', null),
        ],
        month: {
          ...emptyMonth,
          lines: [line(EMPLOYEE, 'line-1', '2026-10-05'), line(EMPLOYEE, 'line-2', '2026-10-20')],
        },
      }),
      request,
    );

    expect(estimate.employees).toHaveLength(1);
    expect(estimate.employees[0]).toMatchObject({ total: '1.000', partial: true });
    expect(estimate.employees[0]?.sources.map((source) => source.source_ref)).toEqual(['line:line-1']);
    expect(estimate.total).toBe('1.000');
  });

  it('shows work done at another branch on a day she was attached to this branch', () => {
    const estimate = buildCommissionEstimate(
      inputs({
        businessWide: false,
        branchIds: [BRANCH_A],
        attachments: [attachment(EMPLOYEE, BRANCH_A, '2026-10-01', null)],
        month: { ...emptyMonth, lines: [line(EMPLOYEE, 'line-1', '2026-10-05', BRANCH_B)] },
      }),
      request,
    );

    expect(estimate.employees[0]?.sources).toHaveLength(1);
    expect(estimate.employees[0]?.sources[0]?.source_branch_id).toBe(BRANCH_B);
    expect(estimate.employees[0]?.partial).toBe(false);
  });

  it('hides an employee attached to no branch of the reader scope', () => {
    const estimate = buildCommissionEstimate(
      inputs({
        businessWide: false,
        branchIds: [BRANCH_A],
        attachments: [attachment(EMPLOYEE, BRANCH_B, '2026-10-01', null)],
        month: {
          ...emptyMonth,
          lines: [line(EMPLOYEE, 'line-1', '2026-10-05'), line(OTHER, 'line-2', '2026-10-06')],
        },
      }),
      request,
    );

    expect(estimate.employees).toEqual([]);
    expect(estimate.total).toBe('0.000');
  });
});

describe('buildCommissionEstimate for rows outside the reader scope', () => {
  it('never shows a row whose attachment set is empty', () => {
    const estimate = buildCommissionEstimate(
      inputs({
        businessWide: false,
        branchIds: [BRANCH_A],
        month: { ...emptyMonth, lines: [line(EMPLOYEE, 'line-1', '2026-10-05')] },
      }),
      request,
    );

    expect(estimate.employees).toEqual([]);
  });

  it('shows a correction-only employee when the correction overlaps the scope', () => {
    const estimate = buildCommissionEstimate(
      inputs({
        businessWide: false,
        branchIds: [BRANCH_A],
        month: {
          ...emptyMonth,
          corrections: [
            {
              employeeId: OTHER,
              sourcePeriod: '2026-09',
              targetPeriod: '2026-10',
              sourceRef: 'line:line-9',
              kind: 'COMMISSION',
              amount: -500n,
              previousAmount: 1000n,
              newAmount: 500n,
              generation: 1n,
              sourceBranchId: BRANCH_A,
              sourceBusinessDate: '2026-09-20',
              attachedBranchIds: [BRANCH_A],
            },
          ],
        },
      }),
      request,
    );

    expect(estimate.employees.map((employee) => employee.employee_id)).toEqual([OTHER]);
    expect(estimate.employees[0]?.corrections).toHaveLength(1);
    expect(estimate.employees[0]?.partial).toBe(true);
  });
});

describe('buildCommissionEstimate statuses and the employee filter', () => {
  it('reports NO_PLAN and keeps the tips split by method', () => {
    const estimate = buildCommissionEstimate(
      inputs({
        month: {
          ...emptyMonth,
          sales: [sale(EMPLOYEE, 'sale-1', '2026-10-05')],
          tips: [
            {
              sessionId: '01920000-0000-7000-8000-0000000000f1',
              employeeId: EMPLOYEE,
              branchId: BRANCH_A,
              businessDate: '2026-10-06',
              method: 'CARD',
              amount: 1500n,
            },
            {
              sessionId: '01920000-0000-7000-8000-0000000000f1',
              employeeId: EMPLOYEE,
              branchId: BRANCH_A,
              businessDate: '2026-10-06',
              method: 'CASH',
              amount: 500n,
            },
          ],
        },
      }),
      request,
    );

    expect(estimate.employees[0]).toMatchObject({
      status: 'NO_PLAN',
      total: '0.000',
      tips: { card: '1.500', cash: '0.500' },
    });
    expect(estimate.total).toBe('0.000');
  });

  it('cannot reveal an inaccessible employee through the employee filter', () => {
    const scope = inputs({
      businessWide: false,
      branchIds: [BRANCH_A],
      attachments: [attachment(EMPLOYEE, BRANCH_A, '2026-10-01', null)],
      month: {
        ...emptyMonth,
        lines: [line(EMPLOYEE, 'line-1', '2026-10-05'), line(OTHER, 'line-2', '2026-10-06')],
      },
    });
    const hidden = buildCommissionEstimate(scope, { ...request, employeeId: OTHER });
    const absent = buildCommissionEstimate(scope, {
      ...request,
      employeeId: '01920000-0000-7000-8000-0000000000ff',
    });

    expect(hidden).toEqual(absent);
    expect(hidden.employees).toEqual([]);
    expect(hidden.total).toBe('0.000');
  });
});
