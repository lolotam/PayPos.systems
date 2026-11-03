import { expect, it } from 'vitest';

import {
  CommissionTipSalaryInputInvalidError,
  reduceCommissionSalaries,
  reduceCommissionTips,
  type CommissionSalaryInputEvent,
  type CommissionSalaryProjectionRow,
  type CommissionTipInputEntry,
  type CommissionTipInputEvent,
  type CommissionTipProjectionRow,
  type CommissionTipProjectionSession,
} from '../commission-tip-salary-inputs.ts';

const tipEntry = (amount: string, employeeId = 'employee-a'): CommissionTipInputEntry => ({
  employeeId,
  method: 'CARD',
  amount,
});

const tipEvent = (overrides: Partial<CommissionTipInputEvent> = {}): CommissionTipInputEvent => ({
  businessId: 'business-a',
  branchId: 'branch-a',
  sessionId: 'session-a',
  businessDate: '2026-10-01',
  revision: 1,
  tips: [],
  ...overrides,
});

const tipRow = (
  overrides: Partial<CommissionTipProjectionRow> = {},
): CommissionTipProjectionRow => ({
  employeeId: 'employee-a',
  method: 'CARD',
  amount: 1000n,
  ...overrides,
});

const tipSession = (
  overrides: Partial<CommissionTipProjectionSession> = {},
): CommissionTipProjectionSession => ({
  sessionId: 'session-a',
  branchId: 'branch-a',
  businessDate: '2026-10-01',
  revision: 1,
  rows: [],
  ...overrides,
});

const salaryEvent = (
  overrides: Partial<CommissionSalaryInputEvent> = {},
): CommissionSalaryInputEvent => ({
  businessId: 'business-a',
  employeeId: 'employee-a',
  effectiveFrom: '2026-10-01',
  amount: '250.000',
  revision: 1,
  ...overrides,
});

const salaryRow = (
  overrides: Partial<CommissionSalaryProjectionRow> = {},
): CommissionSalaryProjectionRow => ({
  employeeId: 'employee-a',
  effectiveFrom: '2026-10-01',
  amount: 250000n,
  revision: 1,
  ...overrides,
});

const refusal = (run: () => unknown): CommissionTipSalaryInputInvalidError => {
  try {
    run();
  } catch (error) {
    return error as CommissionTipSalaryInputInvalidError;
  }
  throw new Error('the reducer was expected to refuse the input');
};

it('applies the first event of a session that has no projection yet', () => {
  const outcome = reduceCommissionTips([], tipEvent({ revision: 1, tips: [tipEntry('2.500')] }));
  expect(outcome.applied).toBe(true);
  expect(outcome.session?.revision).toBe(1);
  expect(outcome.session?.rows).toEqual([
    { employeeId: 'employee-a', method: 'CARD', amount: 2500n },
  ]);
});

it('replaces every prior tip row of the session on a newer revision', () => {
  const held = tipSession({
    revision: 3,
    rows: [
      tipRow({ employeeId: 'employee-a', method: 'CARD', amount: 500n }),
      tipRow({ employeeId: 'employee-b', method: 'CASH', amount: 250n }),
    ],
  });
  const outcome = reduceCommissionTips(
    [held],
    tipEvent({ revision: 4, tips: [tipEntry('1.500', 'employee-c')] }),
  );
  expect(outcome.applied).toBe(true);
  expect(outcome.session?.revision).toBe(4);
  expect(outcome.session?.rows).toEqual([
    { employeeId: 'employee-c', method: 'CARD', amount: 1500n },
  ]);
});

it('leaves the projection alone on an equal revision', () => {
  const held = tipSession({ revision: 4, rows: [tipRow()] });
  const outcome = reduceCommissionTips(
    [held],
    tipEvent({ revision: 4, tips: [tipEntry('9.000', 'employee-z')] }),
  );
  expect(outcome.applied).toBe(false);
  expect(outcome.session).toBeNull();
});

it('leaves the projection alone on an older revision', () => {
  const held = tipSession({ revision: 4, rows: [tipRow()] });
  const outcome = reduceCommissionTips(
    [held],
    tipEvent({ revision: 2, tips: [tipEntry('9.000', 'employee-z')] }),
  );
  expect(outcome.applied).toBe(false);
  expect(outcome.session).toBeNull();
});

it('removes the prior tips and keeps the new revision on an empty newer set', () => {
  const held = tipSession({ revision: 2, rows: [tipRow({ amount: 700n })] });
  const outcome = reduceCommissionTips([held], tipEvent({ revision: 3, tips: [] }));
  expect(outcome.applied).toBe(true);
  expect(outcome.session?.rows).toEqual([]);
  expect(outcome.session?.revision).toBe(3);
});

it('keeps the exact mills of every tip amount', () => {
  const outcome = reduceCommissionTips(
    [],
    tipEvent({
      tips: [tipEntry('12.500'), tipEntry('0.001', 'employee-c'), tipEntry('0.125', 'employee-b')],
    }),
  );
  expect(outcome.session?.rows.map((row) => row.amount)).toEqual([12500n, 1n, 125n]);
});

it('refuses a malformed tip amount instead of reading it as zero', () => {
  for (const amount of ['12.5x', '12.1234', '']) {
    const failure = refusal(() => reduceCommissionTips([], tipEvent({ tips: [tipEntry(amount)] })));
    expect(failure).toBeInstanceOf(CommissionTipSalaryInputInvalidError);
    expect(failure.reason).toBe('MALFORMED_TIP_AMOUNT');
  }
});

it('refuses two entries of the same employee and method in one event', () => {
  const failure = refusal(() =>
    reduceCommissionTips([], tipEvent({ tips: [tipEntry('1.000'), tipEntry('2.000')] })),
  );
  expect(failure).toBeInstanceOf(CommissionTipSalaryInputInvalidError);
  expect(failure.reason).toBe('DUPLICATE_TIP_ENTRY');
});

it('never mutates the caller data', () => {
  const event = tipEvent({ revision: 2, tips: [tipEntry('1.000')] });
  const held = tipSession({ revision: 1, rows: [tipRow({ amount: 700n })] });
  reduceCommissionTips([held], event);
  expect(held).toEqual({
    sessionId: 'session-a',
    branchId: 'branch-a',
    businessDate: '2026-10-01',
    revision: 1,
    rows: [{ employeeId: 'employee-a', method: 'CARD', amount: 700n }],
  });
  expect(event).toEqual({
    businessId: 'business-a',
    branchId: 'branch-a',
    sessionId: 'session-a',
    businessDate: '2026-10-01',
    revision: 2,
    tips: [{ employeeId: 'employee-a', method: 'CARD', amount: '1.000' }],
  });
});

it('replaces the salary row of the same employee and date on a newer revision', () => {
  const held = salaryRow({ revision: 2, amount: 250000n });
  const outcome = reduceCommissionSalaries([held], salaryEvent({ revision: 3, amount: '300.500' }));
  expect(outcome.applied).toBe(true);
  expect(outcome.row).toEqual({
    employeeId: 'employee-a',
    effectiveFrom: '2026-10-01',
    amount: 300500n,
    revision: 3,
  });
});

it('leaves the salary row alone on an equal or an older revision', () => {
  const held = salaryRow({ revision: 4, amount: 250000n });
  const equal = reduceCommissionSalaries([held], salaryEvent({ revision: 4, amount: '999.000' }));
  const older = reduceCommissionSalaries([held], salaryEvent({ revision: 2, amount: '999.000' }));
  expect(equal.applied).toBe(false);
  expect(equal.row).toBeNull();
  expect(older.applied).toBe(false);
  expect(older.row).toBeNull();
});

it('keeps other employees and other effective dates untouched', () => {
  const otherEmployee = salaryRow({ employeeId: 'employee-b', amount: 100000n, revision: 5 });
  const otherDate = salaryRow({ effectiveFrom: '2026-11-01', amount: 120000n, revision: 5 });
  const outcome = reduceCommissionSalaries(
    [otherEmployee, otherDate],
    salaryEvent({ revision: 1, amount: '250.000' }),
  );
  expect(outcome.applied).toBe(true);
  expect(outcome.row?.employeeId).toBe('employee-a');
  expect(outcome.row?.effectiveFrom).toBe('2026-10-01');
  expect(otherEmployee.amount).toBe(100000n);
  expect(otherDate.amount).toBe(120000n);
});

it('converges to the newest revision whatever order the events arrive in', () => {
  const oldest = reduceCommissionSalaries([], salaryEvent({ revision: 1, amount: '100.000' }));
  const middle = reduceCommissionSalaries(
    oldest.row === null ? [] : [oldest.row],
    salaryEvent({ revision: 2, amount: '200.000' }),
  );
  const newest = reduceCommissionSalaries(
    middle.row === null ? [] : [middle.row],
    salaryEvent({ revision: 3, amount: '300.000' }),
  );
  const backwards = reduceCommissionSalaries([], salaryEvent({ revision: 3, amount: '300.000' }));
  const withOlder = reduceCommissionSalaries(
    backwards.row === null ? [] : [backwards.row],
    salaryEvent({ revision: 1, amount: '100.000' }),
  );
  expect(newest.row?.amount).toBe(300000n);
  expect(newest.row?.revision).toBe(3);
  expect(withOlder.applied).toBe(false);
  expect(withOlder.row).toBeNull();
});

it('keeps the exact mills of the salary amount', () => {
  const outcome = reduceCommissionSalaries([], salaryEvent({ amount: '250.125' }));
  expect(outcome.row?.amount).toBe(250125n);
});

it('refuses a malformed salary amount instead of reading it as zero', () => {
  const failure = refusal(() => reduceCommissionSalaries([], salaryEvent({ amount: 'abc' })));
  expect(failure).toBeInstanceOf(CommissionTipSalaryInputInvalidError);
  expect(failure.reason).toBe('MALFORMED_SALARY_AMOUNT');
});

it('never mutates the caller salary rows', () => {
  const held = salaryRow({ revision: 1, amount: 250000n });
  const event = salaryEvent({ revision: 2, amount: '300.500' });
  reduceCommissionSalaries([held], event);
  expect(held).toEqual({
    employeeId: 'employee-a',
    effectiveFrom: '2026-10-01',
    amount: 250000n,
    revision: 1,
  });
  expect(event.amount).toBe('300.500');
});
