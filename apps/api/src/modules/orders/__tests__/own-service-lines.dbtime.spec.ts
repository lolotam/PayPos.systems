import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OwnServiceLines } from '@pospay/contracts';
import { expect, it, vi } from 'vitest';
import {
  DB_TIME_SAMPLES,
  perStatement,
  record,
  sampleDbTime,
  sums,
  type DbTimePage,
  type TimedPlanned,
} from './own-service-lines.dbtime.ts';
import { kindViolations } from './own-service-lines.measure.ts';

const statement = (executionMs: number, table: string): TimedPlanned[number] => ({
  statement: `SELECT ${table}`,
  executionMs,
  planningMs: 0.5,
  plan: {
    'Node Type': 'Index Scan',
    'Relation Name': table,
    'Actual Rows': 7,
    'Actual Loops': 1,
    'Rows Removed by Filter': 11,
    'Shared Hit Blocks': 13,
    'Shared Read Blocks': 0,
  },
});
const six = (executionMs: readonly number[]): TimedPlanned =>
  executionMs.map((ms, index) => statement(ms, `table_${index}`));
const page = {} as OwnServiceLines;
const ok = () => [];

function pageWith(samples: readonly (readonly number[])[]): DbTimePage {
  const queue = [...samples];
  return {
    name: 'cancelled-100',
    kind: 'cursor',
    expected: [],
    run: async () => ({ plans: six(queue.shift() ?? [0]), page }),
  };
}

it('sums Execution Time and Planning Time over the statements of the page and keeps each statement', () => {
  const plans = six([1.5, 2, 3, 4, 5, 6]);
  expect(sums(plans)).toEqual({ execution: 21.5, planning: 3 });
  expect(perStatement(plans)[5]).toEqual({
    name: '6:table_5',
    execution_ms: 6,
    planning_ms: 0.5,
    rows: 7,
    loops: 1,
    rows_removed_by_filter: 11,
    shared_hit: 13,
    shared_read: 0,
  });
});

it('judges every sample of a judged run, with no best-of: one sample at 200 ms fails even if the others are fast', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  const violations: string[] = [];
  const samples = [
    [10, 10, 10, 10, 10, 10],
    [100, 50, 40, 5, 4, 0.9],
    [100, 50, 40, 5, 4, 1.0001],
  ];
  expect(samples).toHaveLength(DB_TIME_SAMPLES);
  const observed = await sampleDbTime(
    'stale statistics',
    [pageWith(samples)],
    { judged: true, check: ok },
    violations,
  );
  expect(observed.get('cursor')).toEqual(new Set([6]));
  expect(violations).toHaveLength(1);
  expect(violations[0]).toContain('cancelled-100 db-time sample 3');
  const line = log.mock.calls
    .map((call) => String(call[1]))
    .find((text) => text.includes('"sample":3'));
  expect(JSON.parse(line ?? '{}')).toMatchObject({
    page: 'cancelled-100',
    statements: 6,
    execution_plus_planning_ms_sum: 203,
  });
  log.mockRestore();
});

it('an unjudged run records one sample per page and never produces a timing violation', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  const violations: string[] = [];
  await sampleDbTime(
    'normal statistics',
    [pageWith([[500, 500, 500, 500, 500, 500]])],
    { judged: false, check: ok },
    violations,
  );
  expect(violations).toEqual([]);
  expect(log).toHaveBeenCalledTimes(1);
  log.mockRestore();
});

it('judges the bound exactly: 200 ms is a violation, 199.9 ms is not', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  const violations: string[] = [];
  const exact = [50, 50, 50, 25, 15, 10];
  const under = [50, 50, 50, 25, 15, 9.9];
  await sampleDbTime(
    'normal statistics',
    [pageWith([under, under, under]), { ...pageWith([exact, under, under]), name: 'exact' }],
    { judged: true, check: ok },
    violations,
  );
  expect(sums(six(exact)).execution).toBe(200);
  expect(violations).toHaveLength(1);
  expect(violations[0]).toContain('exact db-time sample 1');
  log.mockRestore();
});

it('requires a first page and a cursor page, each at exactly five and at exactly six statements', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  const cursorOnly = await sampleDbTime(
    'stale statistics',
    [pageWith([[1, 1, 1, 1, 1, 1]])],
    { judged: false, check: ok },
    [],
  );
  expect(kindViolations('stale statistics db-time', cursorOnly)).toEqual([
    'stale statistics db-time: no first page ran exactly 5 statements',
    'stale statistics db-time: no first page ran exactly 6 statements',
    'stale statistics db-time: no cursor page ran exactly 5 statements',
  ]);
  const firstSix: DbTimePage = {
    ...pageWith([[1, 1, 1, 1, 1, 1]]),
    name: 'first-100',
    kind: 'first',
  };
  const five: DbTimePage = { ...pageWith([[1, 1, 1, 1, 1]]), name: 'x', kind: 'first' };
  const cursorFive: DbTimePage = { ...pageWith([[1, 1, 1, 1, 1]]), name: 'y' };
  const all = await sampleDbTime(
    'stale statistics',
    [pageWith([[1, 1, 1, 1, 1, 1]]), firstSix, five, cursorFive],
    { judged: false, check: ok },
    [],
  );
  expect(kindViolations('stale statistics db-time', all)).toEqual([]);
  log.mockRestore();
});

it('appends each recorded line to POSPAY_57_2B_OUT when it is set, so a passing run keeps its numbers', () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  const dir = mkdtempSync(join(tmpdir(), 'pospay-57-2b-'));
  const file = join(dir, 'out.log');
  vi.stubEnv('POSPAY_57_2B_OUT', file);
  try {
    record('57-2b db-time', '{"a":1}');
    record('57-2b db-time', '{"a":2}');
    expect(readFileSync(file, 'utf8')).toBe('57-2b db-time {"a":1}\n57-2b db-time {"a":2}\n');
  } finally {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
    log.mockRestore();
  }
});
