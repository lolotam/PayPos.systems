import { describe, expect, it } from 'vitest';

import {
  selectCommissionStatementPaidCash,
  type CommissionStatementPaidCashRow,
  type CommissionStatementStoredPayment,
} from '../commission-statement-paid-cash.ts';

function row(employeeId: string, partial = false): CommissionStatementPaidCashRow {
  return { employeeId, partial };
}

function payment(employeeId: string, amount: bigint): CommissionStatementStoredPayment {
  return { employeeId, amount };
}

describe('selectCommissionStatementPaidCash', () => {
  it('keeps stored payments for full-month employees and withholds partial employees', () => {
    const result = selectCommissionStatementPaidCash(
      [
        row('e-full-1', false),
        row('e-full-1', false),
        row('e-partial', true),
        row('e-full-2', false),
      ],
      [payment('e-full-1', 41_005n), payment('e-partial', 12_000n), payment('e-full-2', 18_500n)],
    );

    expect(result).toEqual({
      paidCash: [payment('e-full-1', 41_005n), payment('e-full-2', 18_500n)],
      missingEmployeeIds: [],
    });
  });

  it('returns empty paidCash rather than null when every visible employee is partial', () => {
    const result = selectCommissionStatementPaidCash(
      [row('e-partial-1', true), row('e-partial-2', true)],
      [payment('e-partial-1', 15_000n), payment('e-partial-2', 20_000n)],
    );

    expect(result).toEqual({
      paidCash: [],
      missingEmployeeIds: [],
    });
  });

  it('does not flag a missing payment row for a partial employee, while flagging a missing full-month employee', () => {
    const result = selectCommissionStatementPaidCash(
      [row('e-partial-no-row', true), row('e-full-missing', false)],
      [],
    );

    expect(result).toEqual({
      paidCash: [],
      missingEmployeeIds: ['e-full-missing'],
    });
  });

  it('ignores payment rows whose employees are not visible in the exported rows', () => {
    const result = selectCommissionStatementPaidCash(
      [row('e-visible', false)],
      [payment('e-hidden-other-branch', 30_000n), payment('e-visible', 25_000n)],
    );

    expect(result).toEqual({
      paidCash: [payment('e-visible', 25_000n)],
      missingEmployeeIds: [],
    });
  });

  it('treats an employee with both partial and non-partial rows as partial', () => {
    const result = selectCommissionStatementPaidCash(
      [row('e-mixed', false), row('e-mixed', true), row('e-full', false)],
      [payment('e-mixed', 9_000n), payment('e-full', 50_000n)],
    );

    expect(result).toEqual({
      paidCash: [payment('e-full', 50_000n)],
      missingEmployeeIds: [],
    });
  });
});
