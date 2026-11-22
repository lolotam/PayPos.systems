import { describe, expect, it } from 'vitest';

import { microsToIso, sortedBy } from '../canonical-format.ts';
import { buildCanonicalInput } from '../canonical-input.ts';
import {
  at,
  NOOR,
  octoberRows,
  PERIOD,
  SARA,
  type StatementMonthRows,
} from './statement-fixtures.ts';

/** النص الثابت لمدخل البصمة؛ `JSON.stringify` بيرمي على أي bigint، فنجاحه دليل إن مفيش bigint هرب. */
function text(rows: StatementMonthRows): string {
  return JSON.stringify(buildCanonicalInput(PERIOD, rows));
}

const BASE = text(octoberRows());

interface Parsed {
  employees: Array<{
    employee_id: string;
    lines: Array<Record<string, string>>;
    versions: Array<{ version: string }>;
    carries: unknown[];
  }>;
}

/** المدخل بعد تسلسله وقراءته تاني، فأي bigint أو Date مكشوف بيبان نوعه الحقيقي. */
function parsed(rows: StatementMonthRows): Parsed {
  return JSON.parse(text(rows)) as Parsed;
}

/** كل تعديل لحقل بيقراه المحرك لازم يحرّك المدخل (CM-28، D-26). */
const MOVES: ReadonlyArray<readonly [string, (rows: StatementMonthRows) => StatementMonthRows]> = [
  [
    'a line revision',
    (r) => ({ ...r, lines: [{ ...at(r.lines, 0), revision: 3n }, ...r.lines.slice(1)] }),
  ],
  [
    'a line occurred_at by one microsecond',
    (r) => ({
      ...r,
      lines: [
        { ...at(r.lines, 0), occurredAt: at(r.lines, 0).occurredAt + 1n },
        ...r.lines.slice(1),
      ],
    }),
  ],
  [
    'a line recorded_at',
    (r) => ({
      ...r,
      lines: [
        { ...at(r.lines, 0), recordedAt: at(r.lines, 0).recordedAt + 1n },
        ...r.lines.slice(1),
      ],
    }),
  ],
  [
    'a line business date',
    (r) => ({
      ...r,
      lines: [{ ...at(r.lines, 0), businessDate: '2026-10-06' }, ...r.lines.slice(1)],
    }),
  ],
  [
    'a line service',
    (r) => ({ ...r, lines: [{ ...at(r.lines, 0), serviceId: 'service-9' }, ...r.lines.slice(1)] }),
  ],
  [
    'a line net share',
    (r) => ({ ...r, lines: [{ ...at(r.lines, 0), netShare: 100_001n }, ...r.lines.slice(1)] }),
  ],
  [
    'a line share bps',
    (r) => ({ ...r, lines: [{ ...at(r.lines, 0), shareBps: 5_000n }, ...r.lines.slice(1)] }),
  ],
  [
    'a line counts flag',
    (r) => ({ ...r, lines: [{ ...at(r.lines, 0), counts: false }, ...r.lines.slice(1)] }),
  ],
  [
    'a line rule snapshot value',
    (r) => ({
      ...r,
      lines: [
        { ...at(r.lines, 0), ruleSnapshot: { kind: 'PCT', value: 501n } },
        ...r.lines.slice(1),
      ],
    }),
  ],
  [
    'a line rule snapshot kind',
    (r) => ({
      ...r,
      lines: [
        { ...at(r.lines, 0), ruleSnapshot: { kind: 'FIXED', value: 500n } },
        ...r.lines.slice(1),
      ],
    }),
  ],
  [
    'a cancelled line',
    (r) => ({ ...r, lines: [{ ...at(r.lines, 0), status: 'CANCELLED' }, ...r.lines.slice(1)] }),
  ],
  ['a sale revision', (r) => ({ ...r, sales: [{ ...at(r.sales, 0), revision: 2n }] })],
  [
    'a sale business date',
    (r) => ({ ...r, sales: [{ ...at(r.sales, 0), businessDate: '2026-10-11' }] }),
  ],
  ['a sale price', (r) => ({ ...r, sales: [{ ...at(r.sales, 0), pricePaid: 50_001n }] })],
  ['a sale refund', (r) => ({ ...r, sales: [{ ...at(r.sales, 0), refundedAmount: 20_000n }] })],
  ['a cancelled sale', (r) => ({ ...r, sales: [{ ...at(r.sales, 0), status: 'CANCELLED' }] })],
  ['a tip revision', (r) => ({ ...r, tips: [{ ...at(r.tips, 0), revision: 2n }, at(r.tips, 1)] })],
  [
    'a tip method',
    (r) => ({
      ...r,
      tips: [{ ...at(r.tips, 0), method: 'CASH', sessionId: 'session-9' }, at(r.tips, 1)],
    }),
  ],
  [
    'a tip business date',
    (r) => ({ ...r, tips: [{ ...at(r.tips, 0), businessDate: '2026-10-06' }, at(r.tips, 1)] }),
  ],
  ['a tip amount', (r) => ({ ...r, tips: [{ ...at(r.tips, 0), amount: 6_001n }, at(r.tips, 1)] })],
  [
    'the selected salary amount',
    (r) => ({ ...r, salaries: [{ ...at(r.salaries, 0), amount: 400_001n }] }),
  ],
  [
    'a newer salary entry',
    (r) => ({
      ...r,
      salaries: [...r.salaries, { employeeId: SARA, effectiveFrom: '2026-10-15', amount: 1n }],
    }),
  ],
  ['a plan version number', (r) => ({ ...r, versions: [{ ...at(r.versions, 0), version: 2n }] })],
  [
    'a plan version effective date',
    (r) => ({ ...r, versions: [{ ...at(r.versions, 0), effectiveFrom: '2026-09-01' }] }),
  ],
  [
    'a plan version whole_period',
    (r) => ({ ...r, versions: [{ ...at(r.versions, 0), wholePeriod: true }] }),
  ],
  [
    'a plan version created_at',
    (r) => ({
      ...r,
      versions: [{ ...at(r.versions, 0), createdAt: at(r.versions, 0).createdAt + 1n }],
    }),
  ],
  [
    'a plan base component',
    (r) => ({
      ...r,
      versions: [
        { ...at(r.versions, 0), base: { enabled: true, calc: { kind: 'PCT', value: 100n } } },
      ],
    }),
  ],
  [
    'a plan package-sale calc',
    (r) => ({
      ...r,
      versions: [
        {
          ...at(r.versions, 0),
          packageSale: { enabled: true, calc: { kind: 'FIXED', value: 1_000n } },
        },
      ],
    }),
  ],
  [
    'a plan tier step threshold',
    (r) => ({
      ...r,
      versions: [
        {
          ...at(r.versions, 0),
          tiers: {
            enabled: true,
            mode: 'MARGINAL',
            accumulator: 'AMOUNT',
            steps: [
              { from: { kind: 'AMOUNT', value: 100_000n }, calc: { kind: 'PCT', value: 100n } },
            ],
          },
        },
      ],
    }),
  ],
  [
    'a repair version for the month',
    (r) => ({
      ...r,
      versions: [...r.versions, { ...at(r.versions, 0), version: 2n, repairPeriod: PERIOD }],
    }),
  ],
  [
    'an override rule',
    (r) => ({ ...r, overrides: [{ ...at(r.overrides, 0), rule: { kind: 'ZERO' } }] }),
  ],
  [
    'an override service',
    (r) => ({ ...r, overrides: [{ ...at(r.overrides, 0), serviceId: 'service-2' }] }),
  ],
  [
    'an override created_at',
    (r) => ({
      ...r,
      overrides: [{ ...at(r.overrides, 0), createdAt: at(r.overrides, 0).createdAt + 1n }],
    }),
  ],
  [
    'a received correction amount',
    (r) => ({ ...r, corrections: [{ ...at(r.corrections, 0), amount: 3_001n }] }),
  ],
  [
    'a received correction generation',
    (r) => ({ ...r, corrections: [{ ...at(r.corrections, 0), generation: 2n }] }),
  ],
  [
    'a received correction kind',
    (r) => ({ ...r, corrections: [{ ...at(r.corrections, 0), kind: 'SALE' }] }),
  ],
  [
    'an open blocked correction code',
    (r) => ({ ...r, blocked: [{ ...at(r.blocked, 0), code: 'NO_SALARY' }] }),
  ],
  ['an open blocked correction resolved', (r) => ({ ...r, blocked: [] })],
  [
    'a new open blocked correction',
    (r) => ({
      ...r,
      blocked: [...r.blocked, { employeeId: SARA, sourcePeriod: '2026-07', code: 'NO_PLAN' }],
    }),
  ],
  [
    'a commission carry amount',
    (r) => ({ ...r, carries: [{ ...at(r.carries, 0), amount: -5_001n }, at(r.carries, 1)] }),
  ],
  ['a card-tip carry removed', (r) => ({ ...r, carries: [at(r.carries, 0)] })],
  [
    'a carry from another source statement',
    (r) => ({
      ...r,
      carries: [{ ...at(r.carries, 0), sourceStatementId: 'statement-aug' }, at(r.carries, 1)],
    }),
  ],
  [
    'a plan written for an employee with no other row',
    (r) => ({
      ...r,
      versions: [...r.versions, { ...at(r.versions, 0), employeeId: 'employee-new' }],
    }),
  ],
];

describe('the input fingerprint canonical input', () => {
  it.each(MOVES)('moves when %s changes', (_name, move) => {
    expect(text(move(octoberRows()))).not.toBe(BASE);
  });
});

describe('the input fingerprint stability', () => {
  it('is stable under a shuffle of every list and of the employees', () => {
    const rows = octoberRows();
    const shuffled: StatementMonthRows = {
      lines: [...rows.lines].reverse(),
      sales: [...rows.sales].reverse(),
      tips: [...rows.tips].reverse(),
      salaries: [...rows.salaries].reverse(),
      versions: [...rows.versions].reverse(),
      overrides: [...rows.overrides].reverse(),
      corrections: [...rows.corrections].reverse(),
      blocked: [...rows.blocked].reverse(),
      carries: [...rows.carries].reverse(),
    };
    expect(text(shuffled)).toBe(BASE);
  });

  it('leaves out what the input fingerprint does not own (D-26) and the ids that carry no meaning', () => {
    const rows = octoberRows();
    const same: StatementMonthRows = {
      ...rows,
      lines: [
        { ...at(rows.lines, 0), branchId: 'branch-other', sessionId: 'other', customerId: null },
        ...rows.lines.slice(1),
      ],
      corrections: [
        {
          ...at(rows.corrections, 0),
          id: 'other-id',
          sourceBranchId: 'branch-other',
          attachedBranchIds: [],
          sourceBusinessDate: '2026-09-01',
        },
      ],
    };
    expect(text(same)).toBe(BASE);
  });

  it('ignores a plan version that cannot apply in the month and a salary dated after it', () => {
    const rows = octoberRows();
    const same: StatementMonthRows = {
      ...rows,
      versions: [
        ...rows.versions,
        { ...at(rows.versions, 0), version: 2n, effectiveFrom: '2026-11-01' },
      ],
      salaries: [...rows.salaries, { employeeId: SARA, effectiveFrom: '2026-11-01', amount: 9n }],
    };
    expect(text(same)).toBe(BASE);
  });

  it('counts a carry only toward its target month and its own employee', () => {
    const rows = octoberRows();
    const other: StatementMonthRows = {
      ...rows,
      carries: [
        ...rows.carries,
        { ...at(rows.carries, 0), targetPeriod: '2026-11', sourceStatementId: 'x' },
      ],
    };
    expect(text(other)).toBe(BASE);
  });
});

describe('the shape of the canonical input', () => {
  it('lists employees in ascending id with their lists sorted by identity', () => {
    const { employees } = parsed(octoberRows());
    expect(employees.map((employee) => employee.employee_id)).toEqual([NOOR, SARA]);
    expect(at(employees, 1).lines.map((line) => line.line_id)).toEqual(['line-1', 'line-2']);
  });

  it('writes money as KWD text, integers as decimal text and timestamps with six fraction digits', () => {
    const { employees } = parsed(octoberRows());
    const line = at(at(employees, 1).lines, 0);
    expect(line).toMatchObject({ net_share: '100.000', share_bps: '10000', revision: '2' });
    expect(line.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    expect(at(employees, 1).carries).toEqual([
      { source_statement_id: 'statement-sep', kind: 'COMMISSION', amount: '-5.000' },
      { source_statement_id: 'statement-sep', kind: 'TIP_CARD', amount: '-2.000' },
    ]);
  });

  it('orders plan versions and generations numerically, not as text', () => {
    const rows = octoberRows();
    const many: StatementMonthRows = {
      ...rows,
      versions: [9n, 10n, 2n].map((version) => ({ ...at(rows.versions, 0), version })),
    };
    const { employees } = parsed(many);
    expect(at(employees, 1).versions.map((version) => version.version)).toEqual(['2', '9', '10']);
  });
});

describe('the canonical formatting helpers', () => {
  it('writes microsecond timestamps by integer arithmetic', () => {
    expect(microsToIso(0n)).toBe('1970-01-01T00:00:00.000000Z');
    expect(microsToIso(1_700_000_000_123_456n)).toBe('2023-11-14T22:13:20.123456Z');
    expect(microsToIso(1_700_000_000_000_001n)).not.toBe(microsToIso(1_700_000_000_000_002n));
    expect(microsToIso(-1n)).toBe('1969-12-31T23:59:59.999999Z');
  });

  it('sorts by a composite text key with the later parts breaking ties', () => {
    const sorted = sortedBy(
      [
        { a: 'b', b: '1' },
        { a: 'a', b: '2' },
        { a: 'a', b: '1' },
      ],
      (item) => [item.a, item.b],
    );
    expect(sorted).toEqual([
      { a: 'a', b: '1' },
      { a: 'a', b: '2' },
      { a: 'b', b: '1' },
    ]);
  });
});
