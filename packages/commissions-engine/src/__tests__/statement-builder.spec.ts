import { describe, expect, it } from 'vitest';
import { branchesOn } from '../estimate-visibility.ts';

import { buildStatement } from '../statement-builder.ts';
import type { StatementRow } from '../statement-types.ts';
import {
  at,
  HAWALLI,
  NOOR,
  octoberInput,
  octoberRows,
  SALMIYA,
  SARA,
} from './statement-fixtures.ts';

/** صفوف موظفة بعينها، مرتبة بمرجع المصدر عشان المقارنة ما تتأثرش بترتيب البناء. */
function rowsOf(rows: readonly StatementRow[], employeeId: string): StatementRow[] {
  return rows
    .filter((row) => row.employeeId === employeeId)
    .sort((a, b) => (a.sourceRef < b.sourceRef ? -1 : 1));
}

describe('the statement builder rows', () => {
  it('builds one row per source and kind with the amounts the rules give', () => {
    const { rows, failures } = buildStatement(octoberInput());
    expect(failures).toEqual([]);
    expect(rowsOf(rows, SARA).map((row) => [row.kind, row.sourceRef, row.amount])).toEqual([
      ['CARRY_COMMISSION', 'carry:statement-sep:COMMISSION', '-5.000'],
      ['CARRY_TIP_CARD', 'carry:statement-sep:TIP_CARD', '-2.000'],
      ['CORRECTION', 'correction:correction-1', '3.000'],
      ['EMPLOYEE', `employee:${SARA}`, '0.000'],
      ['COMMISSION', 'line:line-1', '15.000'],
      ['COMMISSION', 'line:line-2', '2.500'],
      ['SALE', 'sale:sale-1', '4.000'],
      ['TIP_CARD', 'tip:session-1:CARD', '6.000'],
      ['TIP_CASH', 'tip:session-1:CASH', '2.000'],
    ]);
    expect(rowsOf(rows, NOOR).map((row) => [row.kind, row.amount])).toEqual([
      ['EMPLOYEE', '0.000'],
      ['COMMISSION', '2.000'],
    ]);
  });

  it('freezes the employee label on every row, including a missing Arabic name', () => {
    const { rows } = buildStatement(octoberInput());
    expect(
      rowsOf(rows, SARA).every((row) => row.employeeNumber === 1 && row.employeeNameEn === 'Sara'),
    ).toBe(true);
    expect(rowsOf(rows, NOOR).every((row) => row.employeeNameAr === null)).toBe(true);
  });
});

describe('the statement builder row detail', () => {
  it('attributes each source to the branches of its own day, from the live attachments', () => {
    const { rows } = buildStatement(octoberInput());
    const byRef = new Map(rowsOf(rows, SARA).map((row) => [row.sourceRef, row]));
    expect(byRef.get('line:line-1')?.attachedBranchIds).toEqual([SALMIYA]);
    expect(byRef.get('line:line-2')?.attachedBranchIds).toEqual([HAWALLI]);
    expect(byRef.get('correction:correction-1')?.attachedBranchIds).toEqual([SALMIYA]);
    // صف EMPLOYEE: كل فروع الشهر مع فروع تصحيحاتها، مرتبة.
    expect(byRef.get(`employee:${SARA}`)?.attachedBranchIds).toEqual([HAWALLI, SALMIYA]);
  });

  it('freezes the visit detail, the names and the customer of a commission row', () => {
    const { rows } = buildStatement(octoberInput());
    const first = rowsOf(rows, SARA).find((row) => row.sourceRef === 'line:line-1');
    expect(first).toMatchObject({
      lineId: 'line-1',
      sessionId: 'session-1',
      serviceId: 'service-1',
      serviceNameAr: 'قص',
      serviceNameEn: 'Cut',
      customerId: 'customer-1',
      customerName: 'Customer One',
      businessDate: '2026-10-05',
      sourceBusinessDate: '2026-10-05',
      sourceBranchId: SALMIYA,
      sourceBranchNameAr: 'السالمية',
      sourceBranchNameEn: 'Salmiya',
    });
    const second = rowsOf(rows, SARA).find((row) => row.sourceRef === 'line:line-2');
    expect(second).toMatchObject({ customerId: null, customerName: null, serviceNameAr: null });
  });

  it('keeps a sale and a tip free of visit detail', () => {
    const { rows } = buildStatement(octoberInput());
    const sale = rowsOf(rows, SARA).find((row) => row.kind === 'SALE');
    expect(sale).toMatchObject({
      lineId: null,
      sessionId: null,
      serviceId: null,
      customerName: null,
    });
    const tip = rowsOf(rows, SARA).find((row) => row.kind === 'TIP_CARD');
    expect(tip).toMatchObject({
      lineId: null,
      sourceBranchId: SALMIYA,
      sourceBusinessDate: '2026-10-05',
    });
  });
});

describe('the statement builder correction and carry rows', () => {
  it('copies a correction as was, became and the signed difference, with the frozen detail of its line', () => {
    const { rows } = buildStatement(octoberInput());
    const correction = rowsOf(rows, SARA).find((row) => row.kind === 'CORRECTION');
    expect(correction).toMatchObject({
      previousAmount: '0.000',
      newAmount: '3.000',
      amount: '3.000',
      sourcePeriod: '2026-09',
      sourceBranchId: SALMIYA,
      sourceBusinessDate: '2026-09-28',
      lineId: 'old-1',
      sessionId: 'session-old',
      serviceId: 'service-1',
      serviceNameAr: 'قص',
      serviceNameEn: 'Cut',
      customerId: 'customer-1',
      customerName: 'Customer One',
      businessDate: '2026-09-28',
    });
  });
});

describe('the statement builder correction detail edge cases', () => {
  it('keeps a sale or tip correction free of line detail, and invents none for a line without a head', () => {
    const rows = octoberRows();
    const base = at(rows.corrections, 0);
    const input = octoberInput({
      ...rows,
      corrections: [
        { ...base, id: 'c-sale', sourceRef: 'sale:old-sale', kind: 'SALE' },
        { ...base, id: 'c-tip', sourceRef: 'tip:old-session:CARD', kind: 'TIP_CARD' },
        { ...base, id: 'c-gone', sourceRef: 'line:no-head', kind: 'COMMISSION' },
      ],
    });
    const corrections = rowsOf(buildStatement(input).rows, SARA).filter((row) =>
      row.kind.startsWith('CORRECTION'),
    );
    expect(corrections).toHaveLength(3);
    for (const row of corrections) {
      expect(row).toMatchObject({
        lineId: null,
        sessionId: null,
        serviceId: null,
        serviceNameEn: null,
        customerId: null,
        customerName: null,
        businessDate: null,
      });
    }
  });

  it('writes a carry with no branch, no work day and no attached branch (D-22)', () => {
    const { rows } = buildStatement(octoberInput());
    const carry = rowsOf(rows, SARA).find((row) => row.kind === 'CARRY_COMMISSION');
    expect(carry).toMatchObject({
      sourcePeriod: '2026-09',
      sourceBranchId: null,
      sourceBranchNameEn: null,
      sourceBusinessDate: null,
      attachedBranchIds: [],
    });
  });

  it('never nets the two carries against each other (BR-06)', () => {
    const { rows } = buildStatement(octoberInput());
    const carries = rowsOf(rows, SARA).filter((row) => row.kind.startsWith('CARRY_'));
    expect(carries.map((row) => row.amount)).toEqual(['-5.000', '-2.000']);
  });
});

describe('the statement builder employees', () => {
  it('gives an in-scope employee with no source one zero EMPLOYEE row and nothing else', () => {
    const input = octoberInput({
      ...octoberRows(),
      lines: [],
      sales: [],
      tips: [],
      corrections: [],
      carries: [],
    });
    const { rows } = buildStatement(input);
    expect(rows.map((row) => [row.employeeId, row.kind, row.amount])).toEqual([
      [NOOR, 'EMPLOYEE', '0.000'],
      [SARA, 'EMPLOYEE', '0.000'],
    ]);
    expect(rows.find((row) => row.employeeId === NOOR)?.attachedBranchIds).toEqual([SALMIYA]);
  });

  it('does not freeze a cancelled line or a line outside the month', () => {
    const rows = octoberRows();
    const [first, second, third] = [at(rows.lines, 0), at(rows.lines, 1), at(rows.lines, 2)];
    const input = octoberInput({
      ...rows,
      lines: [{ ...first, status: 'CANCELLED' }, { ...second, businessDate: '2026-11-02' }, third],
    });
    const built = buildStatement(input).rows.filter((row) => row.kind === 'COMMISSION');
    expect(built.map((row) => row.sourceRef)).toEqual(['line:line-3']);
  });

  it('refuses a row whose employee has no label, because its name is mandatory', () => {
    const input = octoberInput();
    expect(() => buildStatement({ ...input, employees: input.employees.slice(0, 1) })).toThrow(
      'label is missing',
    );
  });

  it('refuses a source whose branch name was not read', () => {
    const input = octoberInput();
    const names = {
      ...input.names,
      branches: new Map([[SALMIYA, { nameAr: null, nameEn: 'Salmiya' }]]),
    };
    expect(() => buildStatement({ ...input, names })).toThrow('branch name is missing');
  });
});

describe('the statement builder pricing failures', () => {
  it('reports NO_PLAN once per employee and freezes no row for the unpriced source', () => {
    const rows = octoberRows();
    const planLine = (lineId: string) => ({
      ...at(rows.lines, 0),
      lineId,
      ruleSnapshot: { kind: 'FOLLOW_PLAN' as const },
    });
    const input = octoberInput({
      ...rows,
      lines: [planLine('plan-a'), planLine('plan-b')],
      versions: [],
      overrides: [],
      sales: [],
    });
    const built = buildStatement(input);
    // الفشل بيشيل فروع الموظفة في يوم المصدر الفاشل، لأن المصدر ده ما بيطلعش له صف (قارئ الفروع).
    const lineDay = at(rows.lines, 0).businessDate;
    const branches = branchesOn(
      input.attachments.filter((attachment) => attachment.employeeId === SARA),
      lineDay,
    );
    expect(branches.length).toBeGreaterThan(0);
    expect(built.failures).toEqual([
      { employeeId: SARA, code: 'NO_PLAN', attachedBranchIds: [...branches].sort() },
    ]);
    expect(built.rows.some((row) => row.kind === 'COMMISSION')).toBe(false);
    expect(built.rows.some((row) => row.kind === 'EMPLOYEE' && row.employeeId === SARA)).toBe(true);
  });
});

describe('the statement attachments', () => {
  it('clips each live link to the month and stores the last day inside it', () => {
    const { attachments } = buildStatement(octoberInput());
    expect(attachments).toEqual([
      { employeeId: NOOR, branchId: SALMIYA, attachedFrom: '2026-10-01', attachedTo: '2026-10-31' },
      { employeeId: SARA, branchId: HAWALLI, attachedFrom: '2026-10-15', attachedTo: '2026-10-31' },
      { employeeId: SARA, branchId: SALMIYA, attachedFrom: '2026-10-01', attachedTo: '2026-10-14' },
    ]);
  });

  it('drops links that do not touch the month and keeps one that ends on its first day boundary', () => {
    const input = octoberInput();
    const attachments = [
      { employeeId: SARA, branchId: SALMIYA, from: '2026-01-01', to: '2026-10-01' },
      { employeeId: SARA, branchId: HAWALLI, from: '2026-11-01', to: null },
      { employeeId: SARA, branchId: SALMIYA, from: '2026-10-10', to: '2026-11-01' },
    ];
    expect(buildStatement({ ...input, attachments }).attachments).toEqual([
      { employeeId: SARA, branchId: SALMIYA, attachedFrom: '2026-10-10', attachedTo: '2026-10-31' },
    ]);
  });

  it('ignores the links of an employee who is not in scope', () => {
    const input = octoberInput();
    const attachments = [
      { employeeId: 'employee-out', branchId: SALMIYA, from: '2026-10-01', to: null },
    ];
    expect(buildStatement({ ...input, attachments }).attachments).toEqual([]);
  });
});
