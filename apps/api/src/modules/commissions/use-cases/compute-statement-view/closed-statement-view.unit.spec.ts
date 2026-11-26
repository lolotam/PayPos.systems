import type { StatementRow } from '@pospay/commissions-engine';
import { expect, it } from 'vitest';

import {
  closedStatementView,
  type ClosedStatementContext,
} from './closed-statement-view.ts';

const BRANCH = '01920000-0000-7000-8000-0000000000b1';
const OTHER = '01920000-0000-7000-8000-0000000000b2';
const EMPLOYEE = '01920000-0000-7000-8000-0000000000e1';

const row = (
  kind: StatementRow['kind'],
  amount: string,
  attachedBranchIds: string[],
): StatementRow => ({
  employeeId: EMPLOYEE,
  employeeNumber: 1,
  employeeNameAr: null,
  employeeNameEn: 'Employee',
  sourceRef: `${kind}:${amount}`,
  kind,
  amount,
  attachedBranchIds,
  previousAmount: null,
  newAmount: null,
  sourcePeriod: null,
  sourceBranchId: null,
  sourceBranchNameAr: null,
  sourceBranchNameEn: null,
  sourceBusinessDate: null,
  lineId: null,
  sessionId: null,
  serviceId: null,
  serviceNameAr: null,
  serviceNameEn: null,
  customerId: null,
  customerName: null,
  businessDate: null,
});

const context: ClosedStatementContext = {
  businessId: OTHER,
  period: '2026-10',
  status: 'PAID',
  approvedAt: '2026-11-01T00:00:00Z',
  inputFingerprint: 'a'.repeat(64),
  statementFingerprint: 'b'.repeat(64),
  scope: { businessWide: true, branchIds: [BRANCH, OTHER] },
  rows: [
    row('EMPLOYEE', '0.000', [BRANCH, OTHER]),
    row('COMMISSION', '10.001', [BRANCH]),
    row('COMMISSION', '4.000', [OTHER]),
  ],
  payment: {
    paidOn: '2026-11-24',
    paidMethod: 'CASH',
    paidNote: null,
    paidAt: '2026-11-24T00:00:00Z',
    paidBy: OTHER,
    payments: [{ employeeId: EMPLOYEE, exactPayable: '14.001', paidAmount: '14.000' }],
  },
};

it('omits whole-month payout amounts when a branch sees only part of an employee month', () => {
  const view = closedStatementView({
    ...context,
    scope: { businessWide: false, branchIds: [BRANCH] },
  });
  expect(view.employees[0]).toMatchObject({
    partial: true,
    commission_subtotal: '10.001',
    tip_side: '0.000',
    payable: '10.001',
  });
  expect(view.payment).toEqual({ paid_on: '2026-11-24', paid_method: 'CASH', payments: [] });
});

it('retains exact and paid amounts when a branch sees the whole employee month', () => {
  const view = closedStatementView({
    ...context,
    scope: { businessWide: false, branchIds: [BRANCH, OTHER] },
  });
  expect(view.employees[0]?.partial).toBe(false);
  expect(view.payment).toEqual({
    paid_on: '2026-11-24',
    paid_method: 'CASH',
    payments: [{ employee_id: EMPLOYEE, exact_payable: '14.001', paid_amount: '14.000' }],
  });
});

it('retains all payment metadata and totals for a business reader', () => {
  expect(closedStatementView(context).payment).toEqual({
    paid_on: '2026-11-24',
    paid_method: 'CASH',
    paid_note: null,
    paid_at: '2026-11-24T00:00:00Z',
    paid_by: OTHER,
    paid_total: '14.000',
    payments: [{ employee_id: EMPLOYEE, exact_payable: '14.001', paid_amount: '14.000' }],
  });
});

it('flags a departed employee from the live set and defaults to not departed', () => {
  expect(closedStatementView(context).employees[0]?.departed).toBe(false);
  const flagged = closedStatementView({ ...context, departed: new Set([EMPLOYEE]) });
  expect(flagged.employees[0]?.departed).toBe(true);
});

it('emits an explicit null payment for a newly approved statement', () => {
  expect(closedStatementView({ ...context, status: 'APPROVED', payment: null }).payment).toBeNull();
});
