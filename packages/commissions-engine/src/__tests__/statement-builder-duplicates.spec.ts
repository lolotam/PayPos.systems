import { describe, expect, it } from 'vitest';

import { buildStatement } from '../statement-builder.ts';
import { StatementDuplicateKeyError } from '../statement-uniqueness.ts';
import type { StatementBuildInput, StatementMonthRows } from '../statement-types.ts';
import { at, NOOR, octoberInput, octoberRows, SALMIYA, SARA } from './statement-fixtures.ts';

/** القائمة وأول عنصر فيها مكرر، زي ما يطلع من قارئ ضم صفوفه مرتين. */
function repeatFirst<T>(list: readonly T[]): T[] {
  return [at(list, 0), ...list];
}

type Repeat = (rows: StatementMonthRows) => StatementMonthRows;

const LINES: Repeat = (rows) => ({ ...rows, lines: repeatFirst(rows.lines) });

/** كل نوع مصدر، وأول عنصر منه مكرر، والمفتاح اللي الباني لازم يسمّيه. */
const REPEATED_SOURCES: ReadonlyArray<readonly [string, Repeat, string]> = [
  ['line', LINES, `${SARA}/line:line-1`],
  ['sale', (r) => ({ ...r, sales: repeatFirst(r.sales) }), `${SARA}/sale:sale-1`],
  ['tip', (r) => ({ ...r, tips: repeatFirst(r.tips) }), `${SARA}/tip:session-1:CARD`],
  [
    'correction',
    (r) => ({ ...r, corrections: repeatFirst(r.corrections) }),
    `${SARA}/correction:correction-1`,
  ],
  [
    'carry',
    (r) => ({ ...r, carries: repeatFirst(r.carries) }),
    `${SARA}/carry:statement-sep:COMMISSION`,
  ],
];

function repeatedInput(repeat: Repeat): StatementBuildInput {
  return octoberInput(repeat(octoberRows()));
}

describe('the statement builder refuses a source row the reader returned twice', () => {
  it.each(REPEATED_SOURCES)('a repeated %s names its key', (_name, repeat, expected) => {
    const input = repeatedInput(repeat);
    expect(() => buildStatement(input)).toThrow(StatementDuplicateKeyError);
    expect(() => buildStatement(input)).toThrow(`repeats a row key: ${expected}`);
  });

  it('carries the kind and the key on the error', () => {
    try {
      buildStatement(repeatedInput(LINES));
      expect.unreachable('the builder must refuse a repeated line');
    } catch (error) {
      expect(error).toBeInstanceOf(StatementDuplicateKeyError);
      expect(error).toMatchObject({ kind: 'row', key: `${SARA}/line:line-1` });
    }
  });

  it('refuses the repeat of a later employee even though an earlier one is fine', () => {
    const rows = octoberRows();
    const noorLine = at(rows.lines, 2);
    const input = octoberInput({ ...rows, lines: [...rows.lines, noorLine] });
    expect(() => buildStatement(input)).toThrow(`repeats a row key: ${NOOR}/line:line-3`);
  });

  it('accepts the same source ref under two different employees', () => {
    const rows = octoberRows();
    const carry = at(rows.carries, 0);
    const input = octoberInput({
      ...rows,
      carries: [...rows.carries, { ...carry, employeeId: NOOR }],
    });
    const carries = buildStatement(input).rows.filter(
      (row) => row.sourceRef === 'carry:statement-sep:COMMISSION',
    );
    expect(carries.map((row) => row.employeeId).sort()).toEqual([NOOR, SARA]);
  });
});

describe('the statement builder refuses a repeated attachment key', () => {
  it('refuses two links of one employee and branch that clip to the same first day', () => {
    const input = octoberInput();
    const attachments = [
      ...input.attachments,
      { employeeId: SARA, branchId: SALMIYA, from: '2026-05-01', to: '2026-10-20' },
    ];
    expect(() => buildStatement({ ...input, attachments })).toThrow(StatementDuplicateKeyError);
    expect(() => buildStatement({ ...input, attachments })).toThrow(
      `repeats an attachment key: ${SARA}/${SALMIYA}/2026-10-01`,
    );
  });

  it('ignores a repeat among the links of an employee who is not in scope', () => {
    const input = octoberInput();
    const link = { employeeId: 'employee-out', branchId: SALMIYA, from: '2026-10-01', to: null };
    const built = buildStatement({ ...input, attachments: [...input.attachments, link, link] });
    expect(built.attachments.some((row) => row.employeeId === 'employee-out')).toBe(false);
  });
});
