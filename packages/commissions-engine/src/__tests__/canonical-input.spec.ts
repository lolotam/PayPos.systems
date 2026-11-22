import { describe, expect, it } from 'vitest';

import { microsToIso, sortedBy } from '../canonical-format.ts';
import { buildCanonicalInput } from '../canonical-input.ts';
import { assembleCommissionPeriodInput } from '../period-input-assembly.ts';
import { EXPECTED_CANONICAL_INPUT, fullRows } from './canonical-input-expected.ts';
import { canonicalMutations, interleaved } from './canonical-input-mutations.ts';
import { at, PERIOD, SARA, type StatementMonthRows } from './statement-fixtures.ts';

/** النص الثابت لمدخل البصمة؛ `JSON.stringify` بيرمي على أي bigint، فنجاحه دليل إن مفيش bigint هرب. */
function text(rows: StatementMonthRows, period = PERIOD): string {
  return JSON.stringify(buildCanonicalInput(period, rows));
}

const BASE = text(fullRows());

/** مسارات الأوراق (leaves) في قيمة JSON، والعنصر في القايمة بيتكتب `[]`. */
function leafPaths(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => leafPaths(item, `${path}[]`));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      leafPaths(item, path === '' ? key : `${path}.${key}`),
    );
  }
  return [path];
}

describe('the input fingerprint canonical input, written by hand (D-26)', () => {
  it('equals the value typed by hand from the rules for the full fixture', () => {
    expect(JSON.parse(BASE)).toEqual(EXPECTED_CANONICAL_INPUT);
  });

  it('has a mutation for every fingerprinted field and no field the hand-written value lacks', () => {
    const fields = [...new Set(leafPaths(EXPECTED_CANONICAL_INPUT))].sort();
    expect(Object.keys(canonicalMutations()).sort()).toEqual(fields);
  });

  it.each(Object.entries(canonicalMutations()))('moves when only %s changes', (_field, mutated) => {
    expect(mutated()).not.toBe(BASE);
  });
});

describe('what the input fingerprint ignores', () => {
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

  it('ignores a salary entry that is not the one selected for the last day of the month', () => {
    const rows = fullRows();
    const same: StatementMonthRows = {
      ...rows,
      salaries: [
        ...rows.salaries.map((salary) =>
          salary.effectiveFrom === '2026-09-01' ? { ...salary, amount: 1n, revision: 99n } : salary,
        ),
        { employeeId: SARA, effectiveFrom: '2026-11-01', amount: 9n, revision: 5n },
      ],
    };
    expect(text(same)).toBe(BASE);
  });
});

describe('what the input fingerprint ignores in plans and carries', () => {
  it('ignores a plan version that cannot apply in the month', () => {
    const rows = fullRows();
    const later = { ...at(rows.versions, 0), version: 20n, effectiveFrom: '2026-11-01' };
    expect(text({ ...rows, versions: [...rows.versions, later] })).toBe(BASE);
  });

  it('ignores a repair version of another month, because pricing ignores it', () => {
    const rows = fullRows();
    const september = {
      ...at(rows.versions, 0),
      version: 21n,
      effectiveFrom: '2026-09-01',
      repairPeriod: '2026-09',
    };
    expect(text({ ...rows, versions: [...rows.versions, september] })).toBe(BASE);
    const assembled = assembleCommissionPeriodInput({
      employeeId: SARA,
      period: PERIOD,
      ...rows,
      versions: [...rows.versions, september],
    });
    expect(assembled.input.versions.map((version) => version.version)).not.toContain(21n);
  });

  it('counts a carry only toward its target month', () => {
    const rows = fullRows();
    const other = { ...at(rows.carries, 0), targetPeriod: '2026-11', sourceStatementId: 'x' };
    expect(text({ ...rows, carries: [...rows.carries, other] })).toBe(BASE);
  });

  it('does not list an employee whose lists are all empty or inapplicable', () => {
    const rows = fullRows();
    const idle = {
      ...at(rows.versions, 0),
      employeeId: 'employee-idle',
      effectiveFrom: '2026-11-01',
    };
    expect(text({ ...rows, versions: [...rows.versions, idle] })).toBe(BASE);
  });
});

describe('the order and the shape of the canonical input', () => {
  it('is stable when the rows of two employees are interleaved or reversed in every list', () => {
    const rows = fullRows();
    expect(text(interleaved(rows))).toBe(BASE);
    expect(text(interleaved(interleaved(rows)))).toBe(BASE);
  });

  it('orders plan versions and generations numerically: 9 before 10, never 10 before 9', () => {
    const [, sara] = JSON.parse(BASE).employees;
    expect(sara.versions.map((version: { version: string }) => version.version)).toEqual([
      '1',
      '9',
      '10',
    ]);
    expect(sara.corrections.map((entry: { generation: string }) => entry.generation)).toEqual([
      '1',
      '9',
      '10',
    ]);
  });
});

describe('the validation and the formatting of the canonical input', () => {
  it('refuses a malformed month even when every list is empty', () => {
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
    expect(() => buildCanonicalInput('2026-13', empty)).toThrow(RangeError);
    expect(() => buildCanonicalInput('26-10', empty)).toThrow(RangeError);
    expect(buildCanonicalInput('2026-10', empty)).toEqual({ period: '2026-10', employees: [] });
  });

  it.each([
    [0n, '0.000'],
    [1n, '0.001'],
    [-1n, '-0.001'],
    [-1_000n, '-1.000'],
    [999n, '0.999'],
  ])('writes %s mills as the three-decimal text %s', (mills, expected) => {
    const rows = fullRows();
    const lines = [{ ...at(rows.lines, 0), netShare: mills }, ...rows.lines.slice(1)];
    const [, sara] = JSON.parse(text({ ...rows, lines })).employees;
    expect(sara.lines[0].net_share).toBe(expected);
  });

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
