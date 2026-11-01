import { expect, it } from 'vitest';

import {
  affectedCommissionPeriods,
  commissionRuleColumns,
  periodOfBusinessDate,
  selectNewerCommissionLines,
  validateCommissionLineEvent,
} from '../commission-lines.ts';
import type { CommissionLineSnapshot } from '../commission-line-types.ts';
import { CommissionLineEventInvalidError } from '../errors.ts';

function line(overrides: Partial<CommissionLineSnapshot> = {}): CommissionLineSnapshot {
  return {
    lineId: 'line-a',
    sessionId: 'session-a',
    businessId: 'business-a',
    branchId: 'branch-a',
    serviceId: 'service-a',
    customerId: 'customer-a',
    status: 'ACTIVE',
    occurredAt: '2026-11-01T09:00:00Z',
    recordedAt: '2026-11-01T09:00:00Z',
    businessDate: '2026-11-01',
    net: '10.001',
    performers: [{ employeeId: 'employee-a', shareBps: 10000 }],
    ruleSnapshot: { kind: 'ZERO' },
    countsSnapshot: true,
    revision: 1,
    ...overrides,
  };
}

const input = (lines: readonly CommissionLineSnapshot[]) => ({
  companyId: 'company-a',
  businessId: 'business-a',
  lines,
});

it('accepts unique lines and unique performers whose shares total 10000', () => {
  expect(() => validateCommissionLineEvent(input([
    line({ performers: [
      { employeeId: 'employee-a', shareBps: 5000 },
      { employeeId: 'employee-b', shareBps: 5000 },
    ] }),
    line({ lineId: 'line-b' }),
  ]))).not.toThrow();
});

const invalidEvents = [
  ['DUPLICATE_LINE_ID', [line(), line()], 'line-a'],
  ['LINE_BUSINESS_MISMATCH', [line({ businessId: 'business-b' })], 'line-a'],
  ['DUPLICATE_PERFORMER', [line({ performers: [
    { employeeId: 'employee-a', shareBps: 5000 },
    { employeeId: 'employee-a', shareBps: 5000 },
  ] })], 'line-a'],
  ['PERFORMER_SHARE_SUM', [line({ performers: [{ employeeId: 'employee-a', shareBps: 9000 }] })], 'line-a'],
] as const;

it.each(invalidEvents)('rejects %s with the named error and line id', (reason, lines, lineId) => {
  let caught: unknown;
  try {
    validateCommissionLineEvent(input(lines));
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(CommissionLineEventInvalidError);
  expect(caught).toMatchObject({ code: 'COMMISSION_LINE_EVENT_INVALID', reason, lineId });
});

it('selects only revisions newer than the held head, including lines without a head', () => {
  const lines = [
    line({ lineId: 'older', revision: 1 }),
    line({ lineId: 'equal', revision: 2 }),
    line({ lineId: 'newer', revision: 3 }),
    line({ lineId: 'unseen', revision: 1 }),
  ];
  const heads = [
    { lineId: 'older', revision: 2, period: '2026-10' },
    { lineId: 'equal', revision: 2, period: '2026-10' },
    { lineId: 'newer', revision: 2, period: '2026-10' },
  ];
  expect(selectNewerCommissionLines(lines, heads).map((line) => line.lineId)).toEqual([
    'newer',
    'unseen',
  ]);
});

it('includes both months when a newer line changes business_date', () => {
  const changed = line({ lineId: 'line-a', businessDate: '2026-11-01', revision: 2 });
  expect(affectedCommissionPeriods([changed], [
    { lineId: 'line-a', revision: 1, period: '2026-10' },
  ])).toEqual(['2026-10', '2026-11']);
});

it('uses only the new month for a line without a held head and sorts unique periods', () => {
  expect(periodOfBusinessDate('2026-11-01')).toBe('2026-11');
  expect(affectedCommissionPeriods([
    line({ lineId: 'line-b', businessDate: '2026-10-31' }),
    line({ businessDate: '2026-11-01' }),
  ], [])).toEqual(['2026-10', '2026-11']);
});

it.each([
  [{ kind: 'FOLLOW_PLAN' }, { ruleKind: 'FOLLOW_PLAN', rulePctBps: null, ruleFixedAmount: null }],
  [{ kind: 'ZERO' }, { ruleKind: 'ZERO', rulePctBps: null, ruleFixedAmount: null }],
  [{ kind: 'PCT', value: 1500 }, { ruleKind: 'PCT', rulePctBps: 1500, ruleFixedAmount: null }],
  [{ kind: 'FIXED', value: '2.500' }, { ruleKind: 'FIXED', rulePctBps: null, ruleFixedAmount: '2.500' }],
] as const)('maps rule snapshot %j to its dedicated storage columns', (rule, expected) => {
  expect(commissionRuleColumns(rule)).toEqual(expected);
});
