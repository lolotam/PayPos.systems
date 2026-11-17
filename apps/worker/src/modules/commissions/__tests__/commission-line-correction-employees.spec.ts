import { expect, it } from 'vitest';

import { affectedCommissionLineEmployees } from '../domain/commission-lines.ts';
import type { CommissionLineSnapshot } from '../domain/commission-line-types.ts';

const line = (patch: Partial<CommissionLineSnapshot> = {}): CommissionLineSnapshot => ({
  lineId: 'line-a',
  sessionId: 'session-a',
  businessId: 'business-a',
  branchId: 'branch-a',
  serviceId: 'service-a',
  customerId: 'customer-a',
  status: 'ACTIVE',
  occurredAt: '2026-10-01T09:00:00Z',
  recordedAt: '2026-10-01T09:00:00Z',
  businessDate: '2026-10-01',
  net: '10.000',
  performers: [{ employeeId: 'employee-new', shareBps: 10000 }],
  ruleSnapshot: { kind: 'ZERO' },
  countsSnapshot: true,
  revision: 2,
  ...patch,
});

it('unions removed and added performers per closed period, including a month move', () => {
  const result = affectedCommissionLineEmployees(
    [line({ businessDate: '2026-11-02' })],
    [
      { lineId: 'line-a', employeeId: 'employee-removed', period: '2026-10' },
      { lineId: 'line-a', employeeId: 'employee-shared', period: '2026-10' },
      { lineId: 'unrelated', employeeId: 'employee-other', period: '2026-10' },
    ],
    ['2026-10'],
  );

  expect(result).toEqual([
    { period: '2026-10', employeeId: 'employee-removed' },
    { period: '2026-10', employeeId: 'employee-shared' },
  ]);
});

it('deduplicates performers and returns period then employee ascending order', () => {
  const result = affectedCommissionLineEmployees(
    [
      line({
        businessDate: '2026-10-02',
        performers: [
          { employeeId: 'employee-z', shareBps: 5000 },
          { employeeId: 'employee-a', shareBps: 5000 },
        ],
      }),
      line({
        lineId: 'line-b',
        businessDate: '2026-09-02',
        performers: [{ employeeId: 'employee-z', shareBps: 10000 }],
      }),
    ],
    [
      { lineId: 'line-a', employeeId: 'employee-a', period: '2026-10' },
      { lineId: 'line-a', employeeId: 'employee-a', period: '2026-10' },
      { lineId: 'line-b', employeeId: 'employee-b', period: '2026-09' },
    ],
    ['2026-10', '2026-09'],
  );

  expect(result).toEqual([
    { period: '2026-09', employeeId: 'employee-b' },
    { period: '2026-09', employeeId: 'employee-z' },
    { period: '2026-10', employeeId: 'employee-a' },
    { period: '2026-10', employeeId: 'employee-z' },
  ]);
});

it('does not derive correction employees for an open period', () => {
  expect(
    affectedCommissionLineEmployees(
      [line()],
      [{ lineId: 'line-a', employeeId: 'employee-old', period: '2026-10' }],
      [],
    ),
  ).toEqual([]);
});
