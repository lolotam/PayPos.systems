import { expect, it } from 'vitest';

import {
  computeClosedOwnCommissionEstimate,
  computeOwnCommissionEstimate,
  type OwnCommissionEstimateInput,
} from '../own-commission-estimate.ts';
import type { CommissionPlanVersion } from '../plan-types.ts';
import type {
  StatementCorrectionSource,
  StatementLineHead,
  StatementLineSource,
  StatementMonthRows,
  StatementRow,
} from '../statement-types.ts';

const EMPLOYEE = '01920000-0000-7000-8000-000000000101';
const COLLEAGUE = '01920000-0000-7000-8000-000000000102';
const BRANCH = '01920000-0000-7000-8000-000000000201';
const SERVICE = '01920000-0000-7000-8000-000000000301';
const PERIOD = '2026-10';

const flatPlan = (): CommissionPlanVersion => ({
  employeeId: EMPLOYEE,
  effectiveFrom: '2026-09-01',
  wholePeriod: false,
  repairPeriod: null,
  createdAt: 1n,
  version: 1n,
  base: { enabled: false },
  tiers: {
    enabled: true,
    mode: 'MARGINAL',
    accumulator: 'AMOUNT',
    steps: [{ from: { kind: 'AMOUNT', value: 400_000n }, calc: { kind: 'PCT', value: 1000n } }],
  },
  packageSale: { enabled: false },
});

function line(overrides: Partial<StatementLineSource> = {}): StatementLineSource {
  return {
    employeeId: EMPLOYEE,
    serviceId: SERVICE,
    branchId: BRANCH,
    lineId: '01920000-0000-7000-8000-00000000d501',
    sessionId: '01920000-0000-7000-8000-00000000d401',
    customerId: null,
    revision: 1n,
    occurredAt: 1n,
    recordedAt: 1n,
    businessDate: '2026-10-05',
    netShare: 500_000n,
    shareBps: 10_000n,
    counts: true,
    ruleSnapshot: { kind: 'FOLLOW_PLAN' },
    status: 'ACTIVE',
    ...overrides,
  };
}

function correction(overrides: Partial<StatementCorrectionSource> = {}): StatementCorrectionSource {
  return {
    id: '01920000-0000-7000-8000-00000000d701',
    employeeId: EMPLOYEE,
    sourcePeriod: '2026-09',
    targetPeriod: PERIOD,
    sourceRef: 'line:01920000-0000-7000-8000-00000000d501',
    kind: 'COMMISSION',
    amount: 1_000n,
    previousAmount: 2_000n,
    newAmount: 3_000n,
    generation: 1n,
    sourceBranchId: BRANCH,
    sourceBusinessDate: '2026-09-20',
    attachedBranchIds: [BRANCH],
    ...overrides,
  };
}

function month(overrides: Partial<StatementMonthRows> = {}): StatementMonthRows {
  return {
    lines: [line()],
    sales: [],
    tips: [],
    salaries: [{ employeeId: EMPLOYEE, effectiveFrom: '2026-01-01', amount: 1_000_000n, revision: 1n }],
    versions: [flatPlan()],
    overrides: [],
    corrections: [],
    carries: [],
    ...overrides,
  };
}

function input(overrides: Partial<OwnCommissionEstimateInput> = {}): OwnCommissionEstimateInput {
  return {
    employeeId: EMPLOYEE,
    period: PERIOD,
    month: month(),
    correctionLineDetails: new Map<string, StatementLineHead>(),
    serviceNames: new Map(),
    ...overrides,
  };
}

it('prices the own active lines of the month and leaves the cancelled and the colleague out', () => {
  const result = computeOwnCommissionEstimate(
    input({
      month: month({
        lines: [
          line(),
          line({ lineId: '01920000-0000-7000-8000-00000000d502', netShare: 900_000n }),
          line({
            lineId: '01920000-0000-7000-8000-00000000d503',
            employeeId: COLLEAGUE,
            netShare: 700_000n,
          }),
          line({
            lineId: '01920000-0000-7000-8000-00000000d504',
            status: 'CANCELLED',
            netShare: 800_000n,
          }),
        ],
      }),
    }),
  );
  expect(result).toMatchObject({
    status: 'ESTIMATE',
    total: '100.000',
    recalculated: false,
  });
  expect(result.status === 'ESTIMATE' ? result.perLine : []).toEqual([
    { lineId: '01920000-0000-7000-8000-00000000d501', amount: '10.000' },
    { lineId: '01920000-0000-7000-8000-00000000d502', amount: '90.000' },
  ]);
});

it('marks the month as recalculated when the plan version starts the whole period', () => {
  const result = computeOwnCommissionEstimate(
    input({
      month: month({
        versions: [{ ...flatPlan(), effectiveFrom: '2026-10-01', wholePeriod: true }],
      }),
    }),
  );
  expect(result).toMatchObject({ status: 'ESTIMATE', recalculated: true });
});

it('refuses the total without a plan and keeps the corrections visible', () => {
  const result = computeOwnCommissionEstimate(
    input({
      month: month({ versions: [], corrections: [correction()] }),
    }),
  );
  expect(result).toMatchObject({ status: 'NO_PLAN' });
  expect(result).not.toHaveProperty('total');
  expect(result).not.toHaveProperty('perLine');
  expect(result.status === 'NO_PLAN' ? result.corrections : []).toHaveLength(1);
});

it('refuses the total without a salary and keeps the corrections visible', () => {
  const salaryPlan: CommissionPlanVersion = {
    ...flatPlan(),
    tiers: {
      enabled: true,
      mode: 'MARGINAL',
      accumulator: 'AMOUNT',
      steps: [
        { from: { kind: 'SALARY_MULTIPLE', value: 100n }, calc: { kind: 'PCT', value: 1000n } },
      ],
    },
  };
  const result = computeOwnCommissionEstimate(
    input({ month: month({ versions: [salaryPlan], salaries: [], corrections: [correction()] }) }),
  );
  expect(result).toMatchObject({ status: 'NO_SALARY' });
  expect(result).not.toHaveProperty('total');
  expect(result.status === 'NO_SALARY' ? result.corrections : []).toHaveLength(1);
});

it('gives a line correction the service of its line and the day of its frozen head', () => {
  const result = computeOwnCommissionEstimate(
    input({
      month: month({ corrections: [correction()] }),
      correctionLineDetails: new Map([
        [
          '01920000-0000-7000-8000-00000000d501',
          {
            sessionId: '01920000-0000-7000-8000-00000000d401',
            serviceId: SERVICE,
            customerId: null,
            businessDate: '2026-09-18',
          },
        ],
      ]),
      serviceNames: new Map([[SERVICE, { nameAr: 'خدمة', nameEn: 'Service' }]]),
    }),
  );
  expect(result.status === 'ESTIMATE' ? result.corrections : []).toEqual([
    {
      kind: 'LINE',
      sourcePeriod: '2026-09',
      businessDate: '2026-09-18',
      serviceNameAr: 'خدمة',
      serviceNameEn: 'Service',
      previousAmount: '2.000',
      newAmount: '3.000',
      amount: '1.000',
    },
  ]);
});

it('keeps a line correction without a head on its own frozen day and without a service name', () => {
  const result = computeOwnCommissionEstimate(
    input({ month: month({ corrections: [correction()] }) }),
  );
  expect(result.status === 'ESTIMATE' ? result.corrections : []).toEqual([
    {
      kind: 'LINE',
      sourcePeriod: '2026-09',
      businessDate: '2026-09-20',
      serviceNameAr: null,
      serviceNameEn: null,
      previousAmount: '2.000',
      newAmount: '3.000',
      amount: '1.000',
    },
  ]);
});

it('gives a sale or a tip correction no service name', () => {
  const result = computeOwnCommissionEstimate(
    input({
      month: month({
        corrections: [
          correction({ kind: 'SALE', sourceRef: 'sale:01920000-0000-7000-8000-00000000d801' }),
          correction({ kind: 'TIP_CARD', sourceRef: 'tip:01920000-0000-7000-8000-00000000d901' }),
          correction({ kind: 'TIP_CASH', sourceRef: 'tip:01920000-0000-7000-8000-00000000d902' }),
        ],
      }),
    }),
  );
  expect(result.status === 'ESTIMATE' ? result.corrections : []).toEqual([
    expect.objectContaining({ kind: 'SALE', serviceNameAr: null, serviceNameEn: null }),
    expect.objectContaining({ kind: 'TIP_CARD', serviceNameAr: null, serviceNameEn: null }),
    expect.objectContaining({ kind: 'TIP_CASH', serviceNameAr: null, serviceNameEn: null }),
  ]);
});

function frozenRow(overrides: Partial<StatementRow> = {}): StatementRow {
  return {
    employeeId: EMPLOYEE,
    employeeNumber: 1,
    employeeNameAr: null,
    employeeNameEn: 'Sarah',
    sourceRef: 'line:01920000-0000-7000-8000-00000000d501',
    kind: 'COMMISSION',
    amount: '50.000',
    previousAmount: null,
    newAmount: null,
    sourcePeriod: null,
    sourceBranchId: BRANCH,
    sourceBranchNameAr: null,
    sourceBranchNameEn: 'Branch',
    sourceBusinessDate: '2026-10-05',
    attachedBranchIds: [BRANCH],
    lineId: '01920000-0000-7000-8000-00000000d501',
    sessionId: '01920000-0000-7000-8000-00000000d401',
    serviceId: SERVICE,
    serviceNameAr: null,
    serviceNameEn: 'Service',
    customerId: null,
    customerName: null,
    businessDate: '2026-10-05',
    ...overrides,
  };
}

it('answers the approved month with the payable of the frozen rows only', () => {
  const result = computeClosedOwnCommissionEstimate([
    frozenRow(),
    frozenRow({ sourceRef: 'sale:1', kind: 'SALE', amount: '10.000', lineId: null, serviceId: null, serviceNameEn: null }),
    frozenRow({ sourceRef: 'tip:1', kind: 'TIP_CARD', amount: '5.000', lineId: null, serviceId: null, serviceNameEn: null }),
    frozenRow({ sourceRef: 'employee', kind: 'EMPLOYEE', amount: '0.000', lineId: null, serviceId: null, serviceNameEn: null }),
  ]);
  expect(result.status).toBe('APPROVED');
  expect(result.total).toBe('65.000');
  expect(result.corrections).toEqual([]);
});

const noLine = { lineId: null, serviceId: null, serviceNameEn: null } as const;
const correctionRow = (ref: number, kind: StatementRow['kind'], detail: Partial<StatementRow> = {}) =>
  frozenRow({
    sourceRef: `correction:${ref}`,
    kind,
    amount: '1.000',
    previousAmount: '2.000',
    newAmount: '3.000',
    sourcePeriod: '2026-09',
    ...detail,
  });

it('reads the corrections of the approved month with the manager detail and never a customer', () => {
  const result = computeClosedOwnCommissionEstimate([
    correctionRow(1, 'CORRECTION'),
    correctionRow(2, 'CORRECTION', noLine),
    correctionRow(3, 'CORRECTION_TIP_CARD', noLine),
    correctionRow(4, 'CORRECTION_TIP_CASH', noLine),
    frozenRow({ customerName: 'Customer', customerId: '01920000-0000-7000-8000-000000000401' }),
  ]);
  expect(result.corrections.map((correction) => correction.kind)).toEqual([
    'LINE',
    'SALE',
    'TIP_CARD',
    'TIP_CASH',
  ]);
  expect(result.corrections[0]).toEqual({
    kind: 'LINE',
    sourcePeriod: '2026-09',
    businessDate: '2026-10-05',
    serviceNameAr: null,
    serviceNameEn: 'Service',
    previousAmount: '2.000',
    newAmount: '3.000',
    amount: '1.000',
  });
  expect(JSON.stringify(result)).not.toMatch(/customer|Customer/i);
});
