import type { StatementRow } from '@pospay/commissions-engine';
import { describe, expect, it } from 'vitest';

import {
  approvalBlockingIssues,
  incompleteLineShares,
  planApprovalCarries,
} from '../approval-plan.ts';
import type { EmploymentDates } from '../employment-overlap.ts';

const LEILA = '0198aaaa-0000-7000-8000-0000000000a1';
const RANA = '0198aaaa-0000-7000-8000-0000000000a2';
const SARA = '0198aaaa-0000-7000-8000-0000000000a3';

function row(
  employeeId: string,
  kind: StatementRow['kind'],
  amount: string,
  ref: string = kind,
): StatementRow {
  return {
    employeeId,
    employeeNumber: 1,
    employeeNameAr: null,
    employeeNameEn: 'Name',
    sourceRef: `${ref}:${employeeId}`,
    kind,
    amount,
    previousAmount: null,
    newAmount: null,
    sourcePeriod: null,
    sourceBranchId: null,
    sourceBranchNameAr: null,
    sourceBranchNameEn: null,
    sourceBusinessDate: null,
    attachedBranchIds: [],
    lineId: null,
    sessionId: null,
    serviceId: null,
    serviceNameAr: null,
    serviceNameEn: null,
    customerId: null,
    customerName: null,
    businessDate: null,
  };
}

const working: EmploymentDates = { hireDate: '2025-01-01', contractEnd: null, deletedOn: null };
const leftSeptember: EmploymentDates = {
  hireDate: '2025-01-01',
  contractEnd: '2026-09-30',
  deletedOn: null,
};

describe('planApprovalCarries (D-22)', () => {
  it('writes both kinds separately for an employee whose commission and card tips are both negative', () => {
    const rows = [
      row(LEILA, 'EMPLOYEE', '0.000'),
      row(LEILA, 'COMMISSION', '-12.500'),
      row(LEILA, 'TIP_CARD', '-3.250'),
    ];

    expect(planApprovalCarries('2026-10', rows, new Map([[LEILA, working]]))).toEqual([
      { employeeId: LEILA, kind: 'COMMISSION', amount: -12500n },
      { employeeId: LEILA, kind: 'TIP_CARD', amount: -3250n },
    ]);
  });

  it('never nets the two sides: a positive tip side leaves a negative commission side to carry whole', () => {
    const rows = [
      row(LEILA, 'EMPLOYEE', '0.000'),
      row(LEILA, 'COMMISSION', '-10.000'),
      row(LEILA, 'TIP_CARD', '25.000'),
    ];

    expect(planApprovalCarries('2026-10', rows, new Map([[LEILA, working]]))).toEqual([
      { employeeId: LEILA, kind: 'COMMISSION', amount: -10000n },
    ]);
  });

  it('counts sales, corrections and incoming carries on the commission side, cash tips on neither', () => {
    const rows = [
      row(LEILA, 'EMPLOYEE', '0.000'),
      row(LEILA, 'COMMISSION', '4.000', 'a'),
      row(LEILA, 'SALE', '1.000'),
      row(LEILA, 'CORRECTION', '-2.000'),
      row(LEILA, 'CARRY_COMMISSION', '-9.000'),
      row(LEILA, 'TIP_CASH', '-50.000'),
    ];

    expect(planApprovalCarries('2026-10', rows, new Map([[LEILA, working]]))).toEqual([
      { employeeId: LEILA, kind: 'COMMISSION', amount: -6000n },
    ]);
  });

  it('writes nothing for zero or positive balances, and an empty month writes nothing', () => {
    const rows = [row(RANA, 'EMPLOYEE', '0.000'), row(SARA, 'COMMISSION', '0.000')];

    expect(planApprovalCarries('2026-10', rows, new Map([[SARA, working]]))).toEqual([]);
    expect(planApprovalCarries('2026-10', [], new Map())).toEqual([]);
  });

  it('does not re-carry a departed employee, whose balance stays negative in the statement', () => {
    const rows = [
      row(RANA, 'EMPLOYEE', '0.000'),
      row(RANA, 'CARRY_COMMISSION', '-7.000'),
      row(LEILA, 'EMPLOYEE', '0.000'),
      row(LEILA, 'COMMISSION', '-1.000'),
    ];
    const employment = new Map([
      [RANA, leftSeptember],
      [LEILA, working],
    ]);

    expect(planApprovalCarries('2026-10', rows, employment)).toEqual([
      { employeeId: LEILA, kind: 'COMMISSION', amount: -1000n },
    ]);
  });

  it('still carries an employee who left on the first day of the month, because her work overlaps it', () => {
    const rows = [row(RANA, 'COMMISSION', '-4.000')];
    const employment = new Map([[RANA, { ...leftSeptember, contractEnd: '2026-10-01' }]]);

    expect(planApprovalCarries('2026-10', rows, employment)).toEqual([
      { employeeId: RANA, kind: 'COMMISSION', amount: -4000n },
    ]);
  });

  it('orders carries by employee then kind so the write is deterministic', () => {
    const rows = [
      row(SARA, 'TIP_CARD', '-1.000'),
      row(SARA, 'COMMISSION', '-2.000'),
      row(LEILA, 'COMMISSION', '-3.000'),
    ];
    const employment = new Map([
      [SARA, working],
      [LEILA, working],
    ]);

    expect(
      planApprovalCarries('2026-10', rows, employment).map((c) => [c.employeeId, c.kind]),
    ).toEqual([
      [LEILA, 'COMMISSION'],
      [SARA, 'COMMISSION'],
      [SARA, 'TIP_CARD'],
    ]);
  });

  it('refuses to guess when an employee with a negative balance has no employment dates', () => {
    expect(() =>
      planApprovalCarries('2026-10', [row(RANA, 'COMMISSION', '-1.000')], new Map()),
    ).toThrow(/Employment dates are missing/);
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
    expect(
      approvalBlockingIssues([
        { employeeId: LEILA, issues: [] },
        {
          employeeId: RANA,
          issues: [
            { kind: 'PRICING', code: 'NO_PLAN', sourcePeriod: null },
            { kind: 'BLOCKED_CORRECTION', code: 'NO_SALARY', sourcePeriod: '2026-09' },
          ],
        },
      ]),
    ).toEqual([
      { employeeId: RANA, code: 'NO_PLAN' },
      { employeeId: RANA, code: 'NO_SALARY' },
    ]);
  });
});
