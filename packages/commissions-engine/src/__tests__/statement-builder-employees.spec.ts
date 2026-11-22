import { describe, expect, it } from 'vitest';

import { buildStatement, StatementCardConflictError } from '../statement-builder.ts';
import type { StatementEmployeeLabel, StatementRow } from '../statement-types.ts';
import {
  at,
  HAWALLI,
  NOOR,
  octoberInput,
  octoberRows,
  SALMIYA,
  SARA,
} from './statement-fixtures.ts';

const JAHRA = 'branch-jahra';
const GONE = 'employee-gone';
const CARRIER = 'employee-carrier';

/** صفوف موظفة بعينها، مرتبة بمرجع المصدر عشان المقارنة ما تتأثرش بترتيب البناء. */
function rowsOf(rows: readonly StatementRow[], employeeId: string): StatementRow[] {
  return rows
    .filter((row) => row.employeeId === employeeId)
    .sort((a, b) => (a.sourceRef < b.sourceRef ? -1 : 1));
}

/** شهر أكتوبر من غير أي مصدر، عشان صف EMPLOYEE وفروعه بس هما اللي يتفحصوا. */
function noSources() {
  return { ...octoberRows(), lines: [], sales: [], tips: [], corrections: [], carries: [] };
}

/** فروع صف EMPLOYEE لنور لما ارتباطاتها هي دي بالظبط. */
function noorBranches(
  attachments: ReadonlyArray<{ branchId: string; from: string; to: string | null }>,
) {
  const input = octoberInput(noSources());
  const built = buildStatement({
    ...input,
    attachments: attachments.map((link) => ({ employeeId: NOOR, ...link })),
  });
  return rowsOf(built.rows, NOOR).map((row) => row.attachedBranchIds);
}

describe('the statement builder employee cards', () => {
  it('joins two identical cards of the same employee into one, with one EMPLOYEE row', () => {
    const input = octoberInput();
    const sara = at(input.employees, 0);
    const doubled = buildStatement({ ...input, employees: [sara, at(input.employees, 1), sara] });
    expect(doubled).toEqual(buildStatement(input));
    expect(rowsOf(doubled.rows, SARA).filter((row) => row.kind === 'EMPLOYEE')).toHaveLength(1);
  });

  it.each<[string, Partial<StatementEmployeeLabel>]>([
    ['name', { nameEn: 'Sarah' }],
    ['Arabic name', { nameAr: null }],
    ['number', { employeeNumber: 7 }],
  ])('refuses two cards of one employee that differ in the %s', (_field, patch) => {
    const input = octoberInput();
    const employees = [...input.employees, { ...at(input.employees, 0), ...patch }];
    expect(() => buildStatement({ ...input, employees })).toThrow(StatementCardConflictError);
    expect(() => buildStatement({ ...input, employees })).toThrow(
      'cards conflict for the same employee id',
    );
  });

  it('names the employee whose cards conflict', () => {
    const input = octoberInput();
    const employees = [...input.employees, { ...at(input.employees, 1), nameEn: 'Nora' }];
    try {
      buildStatement({ ...input, employees });
      expect.unreachable('the builder must refuse conflicting cards');
    } catch (error) {
      expect(error).toBeInstanceOf(StatementCardConflictError);
      expect((error as StatementCardConflictError).employeeId).toBe(NOOR);
    }
  });
});

describe('the statement builder period check', () => {
  it.each(['2026-13', '2026-00', '0000-05', '2026-1', 'October'])(
    'refuses period %s even when the month and the scope are empty',
    (period) => {
      const empty = { ...noSources(), salaries: [], versions: [], overrides: [] };
      const input = { ...octoberInput(empty), period, employees: [], attachments: [] };
      expect(() => buildStatement(input)).toThrow('Commission period must use YYYY-MM');
    },
  );
});

describe('the EMPLOYEE row branches come from the frozen clipped attachments', () => {
  it('ignores a link that covers no day of the month', () => {
    expect(
      noorBranches([
        { branchId: SALMIYA, from: '2026-02-01', to: null },
        { branchId: JAHRA, from: '2026-10-10', to: '2026-10-10' },
        { branchId: HAWALLI, from: '2026-01-01', to: '2026-10-01' },
      ]),
    ).toEqual([[SALMIYA]]);
  });

  it('counts a link that covers only the last day of the month', () => {
    expect(
      noorBranches([
        { branchId: SALMIYA, from: '2026-02-01', to: '2026-10-31' },
        { branchId: JAHRA, from: '2026-10-31', to: null },
      ]),
    ).toEqual([[JAHRA, SALMIYA]]);
  });

  it('counts a link that covers only the first day of the month', () => {
    expect(noorBranches([{ branchId: JAHRA, from: '2026-09-01', to: '2026-10-02' }])).toEqual([
      [JAHRA],
    ]);
  });

  it('freezes exactly the attachments whose branches the EMPLOYEE row lists', () => {
    const input = octoberInput(noSources());
    const links = [
      { employeeId: NOOR, branchId: SALMIYA, from: '2026-02-01', to: null },
      { employeeId: NOOR, branchId: JAHRA, from: '2026-10-10', to: '2026-10-10' },
    ];
    const built = buildStatement({ ...input, attachments: links });
    expect(built.attachments).toEqual([
      { employeeId: NOOR, branchId: SALMIYA, attachedFrom: '2026-10-01', attachedTo: '2026-10-31' },
    ]);
  });
});

describe('the statement builder employees that exist only through a correction or a carry', () => {
  it('gives a departed employee the historical branch of her correction on her EMPLOYEE row', () => {
    const rows = octoberRows();
    const correction = {
      ...at(rows.corrections, 0),
      id: 'correction-gone',
      employeeId: GONE,
      sourceBranchId: HAWALLI,
      attachedBranchIds: [HAWALLI],
    };
    const input = octoberInput({ ...rows, corrections: [correction] });
    const built = buildStatement({
      ...input,
      employees: [
        ...input.employees,
        { employeeId: GONE, employeeNumber: 3, nameAr: null, nameEn: 'Gone' },
      ],
    });
    expect(rowsOf(built.rows, GONE).map((row) => [row.kind, row.attachedBranchIds])).toEqual([
      ['CORRECTION', [HAWALLI]],
      ['EMPLOYEE', [HAWALLI]],
    ]);
    expect(built.attachments.some((link) => link.employeeId === GONE)).toBe(false);
  });

  it('gives an employee who has only a carry one EMPLOYEE row with an empty branch set', () => {
    const rows = octoberRows();
    const carry = { ...at(rows.carries, 0), employeeId: CARRIER };
    const input = octoberInput({ ...rows, carries: [carry] });
    const built = buildStatement({
      ...input,
      employees: [
        ...input.employees,
        { employeeId: CARRIER, employeeNumber: 4, nameAr: null, nameEn: 'Carrier' },
      ],
    });
    const mine = rowsOf(built.rows, CARRIER);
    expect(mine.map((row) => [row.kind, row.amount, row.attachedBranchIds])).toEqual([
      ['CARRY_COMMISSION', '-5.000', []],
      ['EMPLOYEE', '0.000', []],
    ]);
    expect(mine[0]).toMatchObject({
      sourcePeriod: '2026-09',
      sourceBranchId: null,
      sourceBranchNameEn: null,
      sourceBusinessDate: null,
    });
  });

  it('leaves the rows of one employee untouched by the rows of another', () => {
    const full = buildStatement(octoberInput());
    const rows = octoberRows();
    const withoutNoor = octoberInput({
      ...rows,
      lines: rows.lines.filter((line) => line.employeeId !== NOOR),
    });
    expect(rowsOf(buildStatement(withoutNoor).rows, SARA)).toEqual(rowsOf(full.rows, SARA));
  });
});

describe('what the builder does not read', () => {
  it('returns no failure for a month whose only issue is an open blocked correction', () => {
    const rows = octoberRows();
    expect(rows.blocked).toEqual([{ employeeId: NOOR, sourcePeriod: '2026-08', code: 'NO_PLAN' }]);
    expect(buildStatement(octoberInput(rows)).failures).toEqual([]);
  });
});

describe('the month bounds used to clip the attachments', () => {
  it('clips an open link to the last day of a leap February', () => {
    const input = octoberInput(noSources());
    const links = [{ employeeId: NOOR, branchId: SALMIYA, from: '2028-02-10', to: null }];
    const built = buildStatement({ ...input, period: '2028-02', attachments: links });
    expect(built.attachments).toEqual([
      { employeeId: NOOR, branchId: SALMIYA, attachedFrom: '2028-02-10', attachedTo: '2028-02-29' },
    ]);
  });
});
