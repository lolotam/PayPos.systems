import { expect, it } from 'vitest';

import { projectCommissionEstimate } from '../estimate-projection.ts';
import type {
  CommissionEstimateCorrection,
  CommissionEstimateLine,
  CommissionEstimateMonthRows,
  CommissionEstimateSale,
} from '../estimate-projection-types.ts';

const EMPLOYEE = '01920000-0000-7000-8000-0000000000e1';
const BRANCH = '01920000-0000-7000-8000-0000000000c1';
const PERIOD = '2026-11';

/** بند ساري بنسبة عشرة بالمئة في الفرع، بيتسعّر من غير خطة. */
const LINE: CommissionEstimateLine = {
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
  branchId: BRANCH,
};

/** تصحيح مستلم بيسحب عمولة شهر مقفول: مبلغه سالب. */
const NEGATIVE_CORRECTION: CommissionEstimateCorrection = {
  employeeId: EMPLOYEE,
  sourcePeriod: '2026-10',
  targetPeriod: PERIOD,
  sourceRef: 'line:old-a',
  kind: 'COMMISSION',
  amount: -3000n,
  previousAmount: 3000n,
  newAmount: 0n,
  generation: 1n,
  sourceBranchId: BRANCH,
  sourceBusinessDate: '2026-10-05',
  attachedBranchIds: [BRANCH],
};

it('keeps a negative correction and the tips out of the commission subtotal', () => {
  // المجموع عمولة البنود والبيع بس؛ التصحيح السالب والبقشيش بيتعرضوا جنبه من
  // غير ما يتجمعوا عليه (D-1، FR-040).
  const result = projectCommissionEstimate({
    scope: { businessWide: false, branchIds: [BRANCH] },
    period: PERIOD,
    employeeIds: [EMPLOYEE],
    attachments: [{ employeeId: EMPLOYEE, branchId: BRANCH, from: '2026-11-01', to: null }],
    month: {
      lines: [LINE],
      sales: [],
      tips: [
        {
          sessionId: 'tip-a',
          employeeId: EMPLOYEE,
          businessDate: '2026-11-05',
          method: 'CARD',
          amount: 2500n,
          branchId: BRANCH,
        },
      ],
      salaries: [],
      versions: [],
      overrides: [],
      corrections: [NEGATIVE_CORRECTION],
    },
  });

  expect(result.employees[0]?.status).toBe('OK');
  expect(result.employees[0]?.total).toBe(10000n);
  expect(result.total).toBe(10000n);
  expect(result.employees[0]?.corrections.map((row) => row.amount)).toEqual([-3000n]);
  expect(result.employees[0]?.tips).toEqual({ card: 2500n, cash: 0n });
});

/** بيع باقة ساري في الشهر للموظفة في الفرع. */
const SALE: CommissionEstimateSale = {
  saleId: 'sale-a',
  sellerEmployeeId: EMPLOYEE,
  businessDate: '2026-11-05',
  pricePaid: 30000n,
  refundedAmount: 0n,
  status: 'ACTIVE',
  branchId: BRANCH,
};

it.each<[string, Pick<CommissionEstimateMonthRows, 'lines' | 'sales'>]>([
  ['a cancelled line', { lines: [{ ...LINE, status: 'CANCELLED' }], sales: [] }],
  ['a cancelled sale', { lines: [], sales: [{ ...SALE, status: 'CANCELLED' }] }],
  [
    'an active line of another month',
    { lines: [{ ...LINE, businessDate: '2026-10-31' }], sales: [] },
  ],
  [
    'an active sale of another month',
    { lines: [], sales: [{ ...SALE, businessDate: '2026-12-01' }] },
  ],
])('leaves out an unattached employee whose only source is %s', (_name, rows) => {
  // المجمّع المشترك بيسقط المصدر الملغي أو اللي بره الشهر قبل التسعير، فما
  // يبقاش للموظفة أي نشاط ولا ارتباط يخليها تظهر بصفر لقارئ النشاط كله.
  const result = projectCommissionEstimate({
    scope: { businessWide: true, branchIds: [] },
    period: PERIOD,
    employeeIds: [EMPLOYEE],
    attachments: [],
    month: { ...rows, tips: [], salaries: [], versions: [], overrides: [], corrections: [] },
  });

  expect(result.employees).toEqual([]);
});

it('keeps an attached employee whose only source is cancelled as a real zero', () => {
  const result = projectCommissionEstimate({
    scope: { businessWide: true, branchIds: [] },
    period: PERIOD,
    employeeIds: [EMPLOYEE],
    attachments: [{ employeeId: EMPLOYEE, branchId: BRANCH, from: '2026-11-01', to: null }],
    month: {
      lines: [{ ...LINE, status: 'CANCELLED' }],
      sales: [],
      tips: [],
      salaries: [],
      versions: [],
      overrides: [],
      corrections: [],
    },
  });

  expect(result.employees).toHaveLength(1);
  expect(result.employees[0]?.total).toBe(0n);
});
