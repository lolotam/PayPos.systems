import { describe, expect, it } from 'vitest';

import { microsToIso } from '../canonical-format.ts';
import { buildCanonicalInput } from '../canonical-input.ts';
import { assembleCommissionPeriodInput } from '../period-input-assembly.ts';
import { EXPECTED_CANONICAL_INPUT, fullRows } from './canonical-input-expected.ts';
import { canonicalMutations, interleaved, reversed } from './canonical-input-mutations.ts';
import { changedPaths, fill, leafPaths, type Row } from './canonical-input-paths.ts';
import { at, PERIOD, SARA, type StatementMonthRows } from './statement-fixtures.ts';

/** النص الثابت لمدخل البصمة؛ `JSON.stringify` بيرمي على أي bigint، فنجاحه دليل إن مفيش bigint هرب. */
function text(rows: StatementMonthRows, period = PERIOD): string {
  return JSON.stringify(buildCanonicalInput(period, rows));
}

const BASE = text(fullRows());

interface Canonical {
  employees: Array<{
    employee_id: string;
    lines: Array<{ line_id: string }>;
    sales: Array<{ sale_id: string }>;
    versions: Array<{ version: string }>;
    corrections: Array<{ source_ref: string; generation: string }>;
    salary: { revision: string } | null;
  }>;
}

/** الموظفة سارة من المدخل القياسي بعد قراءته تاني. */
function saraOf(rows: StatementMonthRows): Canonical['employees'][number] {
  const found = (JSON.parse(text(rows)) as Canonical).employees.find(
    (employee) => employee.employee_id === SARA,
  );
  if (found === undefined) throw new RangeError('Sara is missing from the canonical input');
  return found;
}

/** التعديل المطلوب بحقله (وتسميته لو للحقل أكتر من تعديل). */
function mutationOf(field: string, label?: string) {
  const found = canonicalMutations().find((m) => m.field === field && m.label === label);
  if (found === undefined) throw new RangeError(`no mutation for ${field}`);
  return found;
}

describe('the input fingerprint canonical input, written by hand (D-26)', () => {
  it('equals the value typed by hand from the rules for the full fixture', () => {
    expect(JSON.parse(BASE)).toEqual(EXPECTED_CANONICAL_INPUT);
  });

  it('has a mutation for every fingerprinted field and no field the hand-written value lacks', () => {
    const fields = [...new Set(leafPaths(EXPECTED_CANONICAL_INPUT))].filter((p) => p !== 'period');
    const covered = [...new Set(canonicalMutations().map((mutation) => mutation.field))];
    expect(covered.sort()).toEqual(fields.sort());
  });

  it.each(
    canonicalMutations().map(
      (mutation) => [mutation.label ?? '', mutation.field, mutation] as const,
    ),
  )(
    'changes exactly the expected paths when only the field changes: %s %s',
    (_label, field, mutation) => {
      const after = JSON.parse(mutation.run());
      expect(JSON.stringify(after)).not.toBe(BASE);
      if (mutation.moves) return;
      const row = fill(
        mutation.row,
        mutation.ids.slice(0, (mutation.row.match(/\[\]/g) ?? []).length),
      );
      const expected = [
        fill(field, mutation.ids),
        ...(mutation.alsoChanges ?? []).map((leaf) => `${row}.${leaf}`),
      ];
      expect(changedPaths(JSON.parse(BASE), after)).toEqual(expected.sort());
    },
  );
});

describe('the path comparison keeps the identity of the changed row', () => {
  it('tells a sibling row whose leaf also changed apart from the targeted row', () => {
    const before = {
      employees: [
        {
          employee_id: 'e1',
          lines: [
            { line_id: 'a', revision: '1' },
            { line_id: 'b', revision: '1' },
          ],
        },
      ],
    };
    const both = {
      employees: [
        {
          employee_id: 'e1',
          lines: [
            { line_id: 'a', revision: '2' },
            { line_id: 'b', revision: '2' },
          ],
        },
      ],
    };
    expect(changedPaths(before, both)).toEqual([
      'employees[e1].lines[a].revision',
      'employees[e1].lines[b].revision',
    ]);
    const one = {
      employees: [
        {
          employee_id: 'e1',
          lines: [
            { line_id: 'a', revision: '2' },
            { line_id: 'b', revision: '1' },
          ],
        },
      ],
    };
    expect(changedPaths(before, one)).toEqual(['employees[e1].lines[a].revision']);
  });
});

describe('rules without a value', () => {
  it('writes ZERO and FOLLOW_PLAN as an object holding only the kind', () => {
    const [noor, sara] = (
      JSON.parse(BASE) as { employees: Array<{ lines: Row[]; overrides: Row[] }> }
    ).employees;
    expect(noor).toBeDefined();
    expect(at(sara?.lines ?? [], 1)['rule_snapshot']).toEqual({ kind: 'FOLLOW_PLAN' });
    expect(Object.keys(at(sara?.lines ?? [], 1)['rule_snapshot'] as Row)).toEqual(['kind']);
    expect(at(sara?.overrides ?? [], 2)['rule']).toEqual({ kind: 'ZERO' });
    expect(Object.keys(at(sara?.overrides ?? [], 2)['rule'] as Row)).toEqual(['kind']);
  });
});

describe('the new value of the fields that matter most', () => {
  it('writes the new salary revision, the new repair period, the new generation and the new carry kind', () => {
    const run = (field: string) => JSON.parse(mutationOf(field).run());
    expect(run('employees[].salary.revision').employees[1].salary.revision).toBe('4');
    expect(run('employees[].versions[].repair_period').employees[1].versions[0].repair_period).toBe(
      PERIOD,
    );
    expect(run('employees[].corrections[].generation').employees[1].corrections[0].generation).toBe(
      '2',
    );
    expect(run('employees[].carries[].kind').employees[1].carries[0].kind).toBe('TIP_CARD');
  });

  it('moves a line to the employee she is attributed to and takes it from the previous one', () => {
    const rows = fullRows();
    const moved = {
      ...rows,
      lines: [{ ...at(rows.lines, 0), employeeId: 'employee-zed' }, ...rows.lines.slice(1)],
    };
    const parsed = JSON.parse(text(moved)) as Canonical;
    const zed = parsed.employees.find((employee) => employee.employee_id === 'employee-zed');
    expect(zed?.lines.map((line) => line.line_id)).toEqual(['line-1']);
    expect(saraOf(moved).lines.map((line) => line.line_id)).toEqual(['line-2']);
  });

  it('leaves the salary amount out of the input: the same effective date and revision with another amount is the same input (D-10)', () => {
    const rows = fullRows();
    const sameRevision = {
      ...rows,
      salaries: rows.salaries.map((s) =>
        s.effectiveFrom === '2026-10-01' ? { ...s, amount: s.amount + 1n } : s,
      ),
    };
    expect(text(sameRevision)).toBe(BASE);
    expect(BASE).not.toContain('400.000');
  });

  it('moves the input when a newer salary revision arrives alone, and not for an unselected entry', () => {
    const rows = fullRows();
    const newer = {
      ...rows,
      salaries: rows.salaries.map((s) =>
        s.effectiveFrom === '2026-10-01' ? { ...s, revision: 4n } : s,
      ),
    };
    expect(text(newer)).not.toBe(BASE);
    const unselected = {
      ...rows,
      salaries: [
        ...rows.salaries.map((s) =>
          s.effectiveFrom === '2026-09-01' ? { ...s, amount: 1n, revision: 99n } : s,
        ),
        { employeeId: SARA, effectiveFrom: '2026-11-01', amount: 9n, revision: 5n },
      ],
    };
    expect(text(unselected)).toBe(BASE);
  });
});

describe('the period field and the rows it selects', () => {
  it('writes the requested period for any valid month, on the same empty rows', () => {
    const empty: StatementMonthRows = {
      lines: [],
      sales: [],
      tips: [],
      salaries: [],
      versions: [],
      overrides: [],
      corrections: [],
      blocked: [],
      carries: [],
    };
    expect(buildCanonicalInput('2026-10', empty)).toEqual({ period: '2026-10', employees: [] });
    expect(buildCanonicalInput('2026-11', empty)).toEqual({ period: '2026-11', employees: [] });
    expect(buildCanonicalInput('2026-11', fullRows()).period).toBe('2026-11');
  });

  it('selects the rows of the requested month: a month with none of the fixture rows lists nobody', () => {
    expect(
      buildCanonicalInput('2026-11', fullRows()).employees.map(
        (e) => (e as { employee_id: string }).employee_id,
      ),
    ).toEqual(['employee-noor', 'employee-sara']);
    expect(JSON.parse(text(fullRows(), '2026-11')).employees[1].lines).toEqual([]);
  });

  it.each(['2026-13', '26-10', '2026-1', '0000-10', 'abcd-10'])(
    'refuses the month %s even when every list is empty',
    (month) => {
      const empty: StatementMonthRows = {
        lines: [],
        sales: [],
        tips: [],
        salaries: [],
        versions: [],
        overrides: [],
        corrections: [],
        blocked: [],
        carries: [],
      };
      expect(() => buildCanonicalInput(month, empty)).toThrow(RangeError);
    },
  );
});

describe('what leaves the canonical input: cancelled sources and what the fingerprint ignores', () => {
  it('drops a cancelled line from the canonical input, and so changes the value', () => {
    const rows = fullRows();
    const cancelled = {
      ...rows,
      lines: [{ ...at(rows.lines, 0), status: 'CANCELLED' as const }, ...rows.lines.slice(1)],
    };
    expect(text(cancelled)).not.toBe(BASE);
    expect(saraOf(cancelled).lines.map((line) => line.line_id)).toEqual(['line-2']);
  });

  it('drops a cancelled package sale from the canonical input, and so changes the value', () => {
    const rows = fullRows();
    const cancelled = {
      ...rows,
      sales: [{ ...at(rows.sales, 0), status: 'CANCELLED' as const }, ...rows.sales.slice(1)],
    };
    expect(text(cancelled)).not.toBe(BASE);
    expect(saraOf(cancelled).sales.map((sale) => sale.sale_id)).toEqual(['sale-2']);
  });
});

describe('what the fingerprint ignores', () => {
  it('ignores the branch attribution of a source and the id of a correction (D-26)', () => {
    const rows = fullRows();
    const same: StatementMonthRows = {
      ...rows,
      lines: [
        { ...at(rows.lines, 0), branchId: 'branch-other', sessionId: 'other', customerId: null },
        ...rows.lines.slice(1),
      ],
      corrections: rows.corrections.map((correction) => ({
        ...correction,
        id: `x-${correction.id}`,
        sourceBranchId: 'b',
        attachedBranchIds: [],
      })),
    };
    expect(text(same)).toBe(BASE);
  });

  it('ignores a plan version that cannot apply in the month and a repair of another month', () => {
    const rows = fullRows();
    const later = { ...at(rows.versions, 0), version: 20n, effectiveFrom: '2026-11-01' };
    const september = {
      ...at(rows.versions, 0),
      version: 21n,
      effectiveFrom: '2026-09-01',
      repairPeriod: '2026-09',
    };
    expect(text({ ...rows, versions: [...rows.versions, later] })).toBe(BASE);
    expect(text({ ...rows, versions: [...rows.versions, september] })).toBe(BASE);
    const assembled = assembleCommissionPeriodInput({
      employeeId: SARA,
      period: PERIOD,
      ...rows,
      versions: [...rows.versions, september],
    });
    expect(assembled.input.versions.map((version) => version.version)).not.toContain(21n);
  });

  it('counts a carry only toward its target month, and lists no employee with nothing in the month', () => {
    const rows = fullRows();
    const other = { ...at(rows.carries, 0), targetPeriod: '2026-11', sourceStatementId: 'x' };
    const idle = {
      ...at(rows.versions, 0),
      employeeId: 'employee-idle',
      effectiveFrom: '2026-11-01',
    };
    expect(
      text({ ...rows, carries: [...rows.carries, other], versions: [...rows.versions, idle] }),
    ).toBe(BASE);
  });
});

describe('the order of the canonical input', () => {
  it('is stable when the rows of two employees are interleaved or reversed in every list', () => {
    const rows = fullRows();
    expect(text(interleaved(rows))).toBe(BASE);
    expect(text(interleaved(interleaved(rows)))).toBe(BASE);
    expect(text(reversed(rows))).toBe(BASE);
  });

  it('orders two corrections of the same source by generation numerically, fed 10 before 9', () => {
    const fed = [...fullRows().corrections].sort((a, b) => Number(b.generation - a.generation));
    expect(fed.map((correction) => correction.generation)).toEqual([10n, 9n, 1n]);
    const sara = saraOf({ ...fullRows(), corrections: fed });
    expect(sara.corrections.map((entry) => entry.generation)).toEqual(['1', '9', '10']);
  });

  it('orders plan versions numerically: 1, 9, 10 and never 1, 10, 9', () => {
    expect(saraOf(reversed(fullRows())).versions.map((version) => version.version)).toEqual([
      '1',
      '9',
      '10',
    ]);
  });
});

describe('the shape and the formatting of the canonical input', () => {
  it.each([
    [0n, '0.000'],
    [1n, '0.001'],
    [-1n, '-0.001'],
    [-1_000n, '-1.000'],
    [999n, '0.999'],
  ])('writes %s mills as the three-decimal text %s', (mills, expected) => {
    const rows = fullRows();
    const lines = [{ ...at(rows.lines, 0), netShare: mills }, ...rows.lines.slice(1)];
    expect(JSON.parse(text({ ...rows, lines })).employees[1].lines[0].net_share).toBe(expected);
  });
});

describe('what canonicalJson accepts and how timestamps are written', () => {
  it('emits only what canonicalJson accepts: plain objects, arrays, strings, booleans, numbers and null', () => {
    const walk = (value: unknown): void => {
      expect(value).not.toBeUndefined();
      expect(typeof value).not.toBe('bigint');
      expect(typeof value).not.toBe('function');
      expect(value instanceof Date).toBe(false);
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
      if (Array.isArray(value)) value.forEach(walk);
      else if (value !== null && typeof value === 'object') {
        expect([Object.prototype, null]).toContain(Object.getPrototypeOf(value));
        Object.values(value).forEach(walk);
      }
    };
    walk(buildCanonicalInput(PERIOD, fullRows()));
  });

  it('writes microsecond timestamps by integer arithmetic', () => {
    expect(microsToIso(0n)).toBe('1970-01-01T00:00:00.000000Z');
    expect(microsToIso(1_700_000_000_123_456n)).toBe('2023-11-14T22:13:20.123456Z');
    expect(microsToIso(1_700_000_000_000_001n)).not.toBe(microsToIso(1_700_000_000_000_002n));
    expect(microsToIso(-1n)).toBe('1969-12-31T23:59:59.999999Z');
  });
});
