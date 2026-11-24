import { describe, expect, it } from 'vitest';

import {
  approvalBlockingIssues,
  incompleteLineShares,
  planApprovalCarries,
  type EmployeeCarryBalance,
} from '../approval-plan.ts';
import type { EmploymentDates } from '../employment-overlap.ts';

const LEILA = '0198aaaa-0000-7000-8000-0000000000a1';
const RANA = '0198aaaa-0000-7000-8000-0000000000a2';
const SARA = '0198aaaa-0000-7000-8000-0000000000a3';

const working: EmploymentDates = { hireDate: '2025-01-01', contractEnd: null, deletedOn: null };
const leftSeptember: EmploymentDates = {
  hireDate: '2025-01-01',
  contractEnd: '2026-09-30',
  deletedOn: null,
};

const balance = (employeeId: string, commission: bigint, tip: bigint): EmployeeCarryBalance => ({
  employeeId,
  commissionCarryOut: commission,
  tipCarryOut: tip,
});

describe('planApprovalCarries (D-22)', () => {
  it('writes both kinds separately for an employee whose commission and card tips are both negative', () => {
    expect(planApprovalCarries('2026-10', [balance(LEILA, -12500n, -3250n)], new Map([[LEILA, working]]))).toEqual([
      { employeeId: LEILA, kind: 'COMMISSION', amount: -12500n },
      { employeeId: LEILA, kind: 'TIP_CARD', amount: -3250n },
    ]);
  });

  it('writes only the negative side, so a zero tip side never nets a negative commission side', () => {
    expect(planApprovalCarries('2026-10', [balance(LEILA, -10000n, 0n)], new Map([[LEILA, working]]))).toEqual([
      { employeeId: LEILA, kind: 'COMMISSION', amount: -10000n },
    ]);
    expect(planApprovalCarries('2026-10', [balance(LEILA, 0n, -4000n)], new Map([[LEILA, working]]))).toEqual([
      { employeeId: LEILA, kind: 'TIP_CARD', amount: -4000n },
    ]);
  });

  it('writes nothing for zero balances, and an empty month writes nothing', () => {
    expect(planApprovalCarries('2026-10', [balance(SARA, 0n, 0n)], new Map([[SARA, working]]))).toEqual([]);
    expect(planApprovalCarries('2026-10', [], new Map())).toEqual([]);
  });

  it('does not re-carry a departed employee, whose balance stays negative in the statement', () => {
    const employment = new Map([
      [RANA, leftSeptember],
      [LEILA, working],
    ]);

    expect(planApprovalCarries('2026-10', [balance(RANA, -7000n, 0n), balance(LEILA, -1000n, 0n)], employment)).toEqual([
      { employeeId: LEILA, kind: 'COMMISSION', amount: -1000n },
    ]);
  });

  it('still carries an employee who left on the first day of the month, because her work overlaps it', () => {
    const employment = new Map([[RANA, { ...leftSeptember, contractEnd: '2026-10-01' }]]);

    expect(planApprovalCarries('2026-10', [balance(RANA, -4000n, 0n)], employment)).toEqual([
      { employeeId: RANA, kind: 'COMMISSION', amount: -4000n },
    ]);
  });

  it('orders carries by employee then kind so the write is deterministic', () => {
    const employment = new Map([
      [SARA, working],
      [LEILA, working],
    ]);

    expect(
      planApprovalCarries('2026-10', [balance(SARA, -2000n, -1000n), balance(LEILA, -3000n, 0n)], employment).map(
        (c) => [c.employeeId, c.kind],
      ),
    ).toEqual([
      [LEILA, 'COMMISSION'],
      [SARA, 'COMMISSION'],
      [SARA, 'TIP_CARD'],
    ]);
  });

  it('refuses to guess when an employee with a negative balance has no employment dates', () => {
    expect(() => planApprovalCarries('2026-10', [balance(RANA, -1000n, 0n)], new Map())).toThrow(
      /Employment dates are missing/,
    );
  });
});

describe('incompleteLineShares (D-14)', () => {
  it('accepts a line whose performers sum to 10000 and ignores cancelled lines', () => {
    expect(
      incompleteLineShares([
        { lineId: 'l1', status: 'ACTIVE', shareBps: 6000n },
        { lineId: 'l1', status: 'ACTIVE', shareBps: 4000n },
        { lineId: 'l2', status: 'CANCELLED', shareBps: 3000n },
      ]),
    ).toEqual([]);
  });

  it('reports short and over-full active lines, sorted', () => {
    expect(
      incompleteLineShares([
        { lineId: 'b', status: 'ACTIVE', shareBps: 9999n },
        { lineId: 'a', status: 'ACTIVE', shareBps: 10000n },
        { lineId: 'a', status: 'ACTIVE', shareBps: 1n },
      ]),
    ).toEqual(['a', 'b']);
  });
});

describe('approvalBlockingIssues (FR-027)', () => {
  it('lists every issue with its employee and nothing for clean employees', () => {
    const employees = [
        { employeeId: LEILA, issues: [] },
        {
          employeeId: RANA,
          issues: [
            { kind: 'PRICING', code: 'NO_PLAN', sourcePeriod: null },
            { kind: 'BLOCKED_CORRECTION', code: 'NO_SALARY', sourcePeriod: '2026-09' },
          ],
        },
      ];

    expect(approvalBlockingIssues(employees)).toEqual([
      { employeeId: RANA, code: 'NO_PLAN' },
      { employeeId: RANA, code: 'NO_SALARY' },
    ]);
  });
});
