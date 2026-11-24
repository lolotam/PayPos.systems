import type { StatementRow } from '@pospay/commissions-engine';
import { describe, expect, it } from 'vitest';

import { planApprovalCarries } from '../../domain/approval-plan.ts';
import type { EmploymentDates } from '../../domain/employment-overlap.ts';
import { employeeCarryBalances } from './carry-balances.ts';

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

describe('the carries planned from frozen rows (D-22)', () => {
  it('never nets the two sides: a positive tip side leaves a negative commission side to carry whole', () => {
    const rows = [
      row(LEILA, 'EMPLOYEE', '0.000'),
      row(LEILA, 'COMMISSION', '-10.000'),
      row(LEILA, 'TIP_CARD', '25.000'),
    ];

    expect(planApprovalCarries('2026-10', employeeCarryBalances(rows), new Map([[LEILA, working]]))).toEqual([
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

    expect(planApprovalCarries('2026-10', employeeCarryBalances(rows), new Map([[LEILA, working]]))).toEqual([
      { employeeId: LEILA, kind: 'COMMISSION', amount: -6000n },
    ]);
  });

  it('plans nothing for an employee with only the zero EMPLOYEE row, and for zero balances', () => {
    const rows = [row(RANA, 'EMPLOYEE', '0.000'), row(SARA, 'COMMISSION', '0.000')];

    expect(planApprovalCarries('2026-10', employeeCarryBalances(rows), new Map([[SARA, working]]))).toEqual([]);
  });
});
