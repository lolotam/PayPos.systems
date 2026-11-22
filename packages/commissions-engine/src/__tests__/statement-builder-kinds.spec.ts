import { describe, expect, it } from 'vitest';

import { buildStatement } from '../statement-builder.ts';
import type { StatementRow } from '../statement-types.ts';
import { at, HAWALLI, octoberInput, octoberRows, SALMIYA, SARA } from './statement-fixtures.ts';

/** صفوف سارة، مرتبة بمرجع المصدر عشان المقارنة ما تتأثرش بترتيب البناء. */
function saraRows(rows: readonly StatementRow[]): StatementRow[] {
  return rows
    .filter((row) => row.employeeId === SARA)
    .sort((a, b) => (a.sourceRef < b.sourceRef ? -1 : 1));
}

/** تصحيحات أربعة أنواع، كل واحد بمعرّفه ومبلغه وبالـ was/became بتوعه. */
function fourCorrections() {
  const base = at(octoberRows().corrections, 0);
  return [
    {
      ...base,
      id: 'c-card',
      sourceRef: 'tip:s-9:CARD',
      kind: 'TIP_CARD' as const,
      amount: 1_500n,
      previousAmount: 500n,
      newAmount: 2_000n,
    },
    {
      ...base,
      id: 'c-cash',
      sourceRef: 'tip:s-9:CASH',
      kind: 'TIP_CASH' as const,
      amount: -250n,
      previousAmount: 1_000n,
      newAmount: 750n,
    },
    {
      ...base,
      id: 'c-line',
      sourceRef: 'line:old-1',
      kind: 'COMMISSION' as const,
      amount: 3_000n,
      previousAmount: 0n,
      newAmount: 3_000n,
    },
    {
      ...base,
      id: 'c-sale',
      sourceRef: 'sale:old-sale',
      kind: 'SALE' as const,
      amount: -4_000n,
      previousAmount: 4_000n,
      newAmount: 0n,
    },
  ];
}

describe('the statement builder correction row kinds', () => {
  it('maps each correction kind to its row kind, keyed by the correction id, with the signed difference', () => {
    const input = octoberInput({ ...octoberRows(), corrections: fourCorrections() });
    const corrections = saraRows(buildStatement(input).rows).filter((row) =>
      row.kind.startsWith('CORRECTION'),
    );
    expect(
      corrections.map((row) => [
        row.kind,
        row.sourceRef,
        row.amount,
        row.previousAmount,
        row.newAmount,
      ]),
    ).toEqual([
      ['CORRECTION_TIP_CARD', 'correction:c-card', '1.500', '0.500', '2.000'],
      ['CORRECTION_TIP_CASH', 'correction:c-cash', '-0.250', '1.000', '0.750'],
      ['CORRECTION', 'correction:c-line', '3.000', '0.000', '3.000'],
      ['CORRECTION', 'correction:c-sale', '-4.000', '4.000', '0.000'],
    ]);
  });

  it('gives only the line-sourced correction the detail of its line', () => {
    const input = octoberInput({ ...octoberRows(), corrections: fourCorrections() });
    const byRef = new Map(saraRows(buildStatement(input).rows).map((row) => [row.sourceRef, row]));
    expect(byRef.get('correction:c-line')).toMatchObject({
      lineId: 'old-1',
      sessionId: 'session-old',
    });
    for (const ref of ['correction:c-card', 'correction:c-cash', 'correction:c-sale']) {
      expect(byRef.get(ref)).toMatchObject({ lineId: null, sessionId: null, serviceId: null });
    }
  });
});

describe('the statement builder signs and zero amounts', () => {
  it('keeps a negative commission subtotal, a negative carry and positive card tips as separate rows (BR-06)', () => {
    const rows = octoberRows();
    const refund = {
      ...at(rows.corrections, 0),
      id: 'c-refund',
      sourceRef: 'line:old-1',
      amount: -3_000n,
      previousAmount: 3_000n,
      newAmount: 0n,
    };
    const input = octoberInput({
      ...rows,
      lines: [],
      sales: [],
      corrections: [refund],
      carries: [at(rows.carries, 0)],
    });
    const mine = saraRows(buildStatement(input).rows).filter((row) => row.kind !== 'EMPLOYEE');
    expect(mine.map((row) => [row.kind, row.sourceRef, row.amount])).toEqual([
      ['CARRY_COMMISSION', 'carry:statement-sep:COMMISSION', '-5.000'],
      ['CORRECTION', 'correction:c-refund', '-3.000'],
      ['TIP_CARD', 'tip:session-1:CARD', '6.000'],
      ['TIP_CASH', 'tip:session-1:CASH', '2.000'],
    ]);
  });

  it('freezes a real source whose amount is 0.000', () => {
    const rows = octoberRows();
    const free = { ...at(rows.lines, 1), lineId: 'line-free', netShare: 0n };
    const input = octoberInput({
      ...rows,
      lines: [free],
      sales: [],
      tips: [],
      corrections: [],
      carries: [],
    });
    const mine = saraRows(buildStatement(input).rows);
    expect(mine.map((row) => [row.kind, row.sourceRef, row.amount])).toEqual([
      ['EMPLOYEE', `employee:${SARA}`, '0.000'],
      ['COMMISSION', 'line:line-free', '0.000'],
    ]);
  });
});

describe('the branches of the day of a source', () => {
  it('lists, sorted, every branch the employee is attached to on that day', () => {
    const input = octoberInput();
    const attachments = [
      { employeeId: SARA, branchId: SALMIYA, from: '2026-01-01', to: null },
      { employeeId: SARA, branchId: HAWALLI, from: '2026-10-05', to: '2026-10-20' },
    ];
    const built = buildStatement({ ...input, attachments });
    const byRef = new Map(saraRows(built.rows).map((row) => [row.sourceRef, row]));
    expect(byRef.get('line:line-1')?.attachedBranchIds).toEqual([HAWALLI, SALMIYA]);
    expect(byRef.get('sale:sale-1')?.attachedBranchIds).toEqual([HAWALLI, SALMIYA]);
    expect(byRef.get(`employee:${SARA}`)?.attachedBranchIds).toEqual([HAWALLI, SALMIYA]);
  });

  it('lists a branch only on the days its half-open link covers', () => {
    const input = octoberInput();
    const attachments = [
      { employeeId: SARA, branchId: SALMIYA, from: '2026-01-01', to: '2026-10-05' },
      { employeeId: SARA, branchId: HAWALLI, from: '2026-10-05', to: null },
    ];
    const built = buildStatement({ ...input, attachments });
    const line = saraRows(built.rows).find((row) => row.sourceRef === 'line:line-1');
    expect(line?.attachedBranchIds).toEqual([HAWALLI]);
  });
});
