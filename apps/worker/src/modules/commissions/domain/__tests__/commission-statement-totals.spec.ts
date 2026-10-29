import { expect, it } from 'vitest';

import {
  summarizeCommissionStatement,
  type CommissionStatementEmployeeTotal,
  type CommissionStatementRowKind,
  type CommissionStatementSummaryRow,
} from '../commission-statement-totals.ts';

type SummaryRow = CommissionStatementSummaryRow;

function row(overrides: Partial<SummaryRow> = {}): SummaryRow {
  return {
    employeeId: 'employee-1',
    employeeNumber: 7,
    employeeNameAr: 'سارة',
    employeeNameEn: 'Sara',
    kind: 'EMPLOYEE',
    amount: 0n,
    partial: false,
    ...overrides,
  };
}

function only(rows: readonly SummaryRow[]): CommissionStatementEmployeeTotal {
  const totals = summarizeCommissionStatement(rows);
  expect(totals).toHaveLength(1);
  const [employee] = totals;
  if (employee === undefined) throw new Error('the summary is empty');
  return employee;
}

const TOTALS = [
  'commission',
  'salesCommission',
  'corrections',
  'cardTips',
  'cashTips',
] as const;

const KIND_TARGETS: readonly {
  readonly kind: CommissionStatementRowKind;
  readonly total: (typeof TOTALS)[number];
}[] = [
  { kind: 'COMMISSION', total: 'commission' },
  { kind: 'SALE', total: 'salesCommission' },
  { kind: 'TIP_CARD', total: 'cardTips' },
  { kind: 'TIP_CASH', total: 'cashTips' },
  { kind: 'CORRECTION', total: 'corrections' },
  { kind: 'CORRECTION_TIP_CARD', total: 'cardTips' },
  { kind: 'CORRECTION_TIP_CASH', total: 'cashTips' },
  { kind: 'CARRY_COMMISSION', total: 'corrections' },
  { kind: 'CARRY_TIP_CARD', total: 'cardTips' },
];

it.each(KIND_TARGETS)('puts a $kind row into $total and nowhere else', ({ kind, total }) => {
  const employee = only([row({ kind, amount: 5_000n })]);
  for (const candidate of TOTALS) {
    expect(employee[candidate]).toBe(candidate === total ? 5_000n : 0n);
  }
});

it('keeps the employee row out of every total', () => {
  const employee = only([row({ kind: 'EMPLOYEE', amount: 9_000n })]);
  for (const candidate of TOTALS) {
    expect(employee[candidate]).toBe(0n);
  }
  expect(employee.netPayable).toBe(0n);
});

it('adds the commission side and the card tips without netting them against each other', () => {
  const employee = only([
    row({ kind: 'COMMISSION', amount: 41_003n }),
    row({ kind: 'SALE', amount: 10_000n }),
    row({ kind: 'CORRECTION', amount: -2_000n }),
    row({ kind: 'CARRY_COMMISSION', amount: -3_000n }),
    row({ kind: 'TIP_CARD', amount: 6_000n }),
    row({ kind: 'CORRECTION_TIP_CARD', amount: -1_000n }),
    row({ kind: 'CARRY_TIP_CARD', amount: 2_000n }),
    row({ kind: 'TIP_CASH', amount: 4_000n }),
    row({ kind: 'CORRECTION_TIP_CASH', amount: 500n }),
  ]);
  expect(employee.commission).toBe(41_003n);
  expect(employee.salesCommission).toBe(10_000n);
  expect(employee.corrections).toBe(-5_000n);
  expect(employee.cardTips).toBe(7_000n);
  expect(employee.cashTips).toBe(4_500n);
  expect(employee.netPayable).toBe(53_003n);
});

it('pays zero for a negative commission side while the card tips still count', () => {
  const employee = only([
    row({ kind: 'COMMISSION', amount: -25_000n }),
    row({ kind: 'TIP_CARD', amount: 6_000n }),
    row({ kind: 'TIP_CASH', amount: 4_000n }),
  ]);
  expect(employee.commission).toBe(-25_000n);
  expect(employee.netPayable).toBe(6_000n);
});

it('pays zero for negative card tips and keeps the commission side', () => {
  const employee = only([
    row({ kind: 'COMMISSION', amount: 10_000n }),
    row({ kind: 'TIP_CARD', amount: -4_000n }),
  ]);
  expect(employee.cardTips).toBe(-4_000n);
  expect(employee.netPayable).toBe(10_000n);
});

it('keeps the cash tips out of the net payable', () => {
  const employee = only([
    row({ kind: 'COMMISSION', amount: 10_000n }),
    row({ kind: 'TIP_CASH', amount: 4_000n }),
    row({ kind: 'CORRECTION_TIP_CASH', amount: 500n }),
  ]);
  expect(employee.cashTips).toBe(4_500n);
  expect(employee.netPayable).toBe(10_000n);
});

it('keeps the first-seen order of the employees', () => {
  const totals = summarizeCommissionStatement([
    row({ employeeId: 'employee-2', employeeNumber: 9, kind: 'COMMISSION', amount: 1_000n }),
    row({ employeeId: 'employee-1', employeeNumber: 7, kind: 'COMMISSION', amount: 2_000n }),
    row({ employeeId: 'employee-2', employeeNumber: 9, kind: 'TIP_CARD', amount: 300n }),
  ]);
  expect(totals.map((employee) => employee.employeeId)).toEqual(['employee-2', 'employee-1']);
  expect(totals.map((employee) => employee.employeeNumber)).toEqual([9, 7]);
  expect(totals[0]?.netPayable).toBe(1_300n);
  expect(totals[1]?.netPayable).toBe(2_000n);
});

it('carries the partial flag of the employee into the total', () => {
  const employee = only([
    row({ kind: 'EMPLOYEE', partial: true }),
    row({ kind: 'COMMISSION', amount: 5_000n, partial: true }),
  ]);
  expect(employee.partial).toBe(true);
});
