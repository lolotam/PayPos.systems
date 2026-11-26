import { describe, expect, it } from 'vitest';

import { commissionStatementEmployee } from '../statement.js';
import {
  commissionClosedStatementBranchView,
  commissionClosedStatementView,
  commissionStatementApproveRequest,
} from '../statement-approval.js';

const HASH = 'a'.repeat(64);
const BUSINESS = '0198aaaa-0000-7000-8000-000000000001';

describe('commissionStatementApproveRequest', () => {
  it('accepts exactly the two fingerprints the reviewer saw', () => {
    expect(
      commissionStatementApproveRequest.safeParse({
        expected_fingerprint: HASH,
        expected_statement_fingerprint: HASH,
      }).success,
    ).toBe(true);
  });

  it.each([
    ['an uppercase fingerprint', { expected_fingerprint: 'A'.repeat(64), expected_statement_fingerprint: HASH }],
    ['a short fingerprint', { expected_fingerprint: 'abc', expected_statement_fingerprint: HASH }],
    ['a missing statement fingerprint', { expected_fingerprint: HASH }],
    [
      'an unknown field, since the body is strict',
      { expected_fingerprint: HASH, expected_statement_fingerprint: HASH, force: true },
    ],
  ])('refuses %s', (_label, body) => {
    expect(commissionStatementApproveRequest.safeParse(body).success).toBe(false);
  });
});

describe('the closed statement views', () => {
  const closed = {
    reader_scope: 'BUSINESS' as const,
    business_id: BUSINESS,
    period: '2026-10',
    status: 'APPROVED' as const,
    approved_at: '2026-11-15T10:00:00.123456Z',
    input_fingerprint: HASH,
    statement_fingerprint: HASH,
    employees: [],
  };

  it('accepts a business-wide closed view with its approval time and frozen fingerprints', () => {
    expect(commissionClosedStatementView.safeParse(closed).success).toBe(true);
    expect(commissionClosedStatementView.parse(closed).payment).toBeNull();
    expect(commissionClosedStatementView.parse({ ...closed, payment: null }).payment).toBeNull();
  });

  it.each([
    ['a status that is not closed', { ...closed, status: 'REVIEWED' }],
    ['an approval time with no offset', { ...closed, approved_at: '2026-11-15T10:00:00' }],
    ['a branch scope on the business view', { ...closed, reader_scope: 'BRANCHES' }],
  ])('refuses %s', (_label, view) => {
    expect(commissionClosedStatementView.safeParse(view).success).toBe(false);
  });

  it('gives a branch reader the status and her rows only, with no whole-statement field', () => {
    const view = {
      reader_scope: 'BRANCHES' as const,
      business_id: BUSINESS,
      period: '2026-10',
      status: 'PAID' as const,
      payment: null,
      employees: [],
    };

    expect(commissionClosedStatementBranchView.safeParse(view).success).toBe(true);
    expect(commissionClosedStatementBranchView.parse({ ...view, input_fingerprint: HASH })).toEqual(view);
  });

});

describe('employee totals in a closed statement', () => {
  const employeeWith = (commission: string, tip: string, payable: string) => ({
    employee_id: BUSINESS,
    employee_number: 1,
    name_ar: null,
    name_en: 'Total',
    partial: false,
    departed: false,
    commission_subtotal: commission,
    tip_side: tip,
    payable,
    rows: [],
    issues: [],
  });

  it('accepts a total above what one numeric(14,3) row can hold, since a month sums many rows', () => {
    const employee = employeeWith('199999999998.000', '-199999999998.000', '199999999998.000');
    const closed = {
      reader_scope: 'BUSINESS' as const,
      business_id: BUSINESS,
      period: '2026-10',
      status: 'APPROVED' as const,
      approved_at: '2026-11-15T10:00:00.123456Z',
      input_fingerprint: HASH,
      statement_fingerprint: HASH,
      employees: [employee],
    };

    expect(commissionStatementEmployee.safeParse(employee).success).toBe(true);
    expect(commissionClosedStatementView.safeParse(closed).success).toBe(true);
  });

  it('still refuses a total with more than sixteen integer digits, which no bigint of mills can hold', () => {
    const employee = employeeWith('10000000000000000.000', '0.000', '0.000');

    expect(commissionStatementEmployee.safeParse(employee).success).toBe(false);
  });
});
