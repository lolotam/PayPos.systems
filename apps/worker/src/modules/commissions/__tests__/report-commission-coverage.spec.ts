import type { ClaimedEvent } from '@pospay/db';
import { describe, expect, it, vi } from 'vitest';

import type {
  CoverageTenantRunner,
  CoverageTx,
  SalaryCoverageCursor,
  SalaryCoverageRow as SalaryRow,
  ServiceLineCoverageRow as LineRow,
} from '../ports/commission-coverage.port.ts';
import {
  CommissionCoverageEventInvalidError,
  runCommissionCoverageReport,
  type CommissionCoverageDeps,
} from '../use-cases/report-commission-coverage/report-commission-coverage.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const OTHER = '01920000-0000-7000-8000-0000000000b0';
const CONSUMER = 'commission-coverage';
// القارئات ما بتمسّش الـ tx، فكائن فارغ بيناسب الـ port من غير أي جدول حقيقي.
const DUMMY_TX = {} as unknown as CoverageTx;

const eventId = (n: number): string =>
  `01970000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const lineId = (n: number): string =>
  `01980000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const event = (n: number, kind = 'ServiceSessionRecorded', company = COMPANY): ClaimedEvent => ({
  companyId: company,
  id: eventId(n),
  aggregateType: 'service_session',
  aggregateId: eventId(n),
  eventType: kind,
  payload: { sensitive: 'leak-me' },
  attempt: 1,
});

const line = (n: number, rev: number): LineRow => ({ lineId: lineId(n), revision: rev });

const salary = (employeeId: string, from: string, rev: number): SalaryRow =>
  ({ employeeId, effectiveFrom: from, revision: rev });

const sourceLines = (count: number): LineRow[] =>
  Array.from({ length: count }, (_, index) => line(index + 1, 1));

const allMarked = (events: readonly ClaimedEvent[]): ReadonlySet<string> =>
  new Set(events.map((item) => item.id));

function lineReader(rows: readonly LineRow[]) {
  const sorted = [...rows].sort((left, right) => (left.lineId < right.lineId ? -1 : 1));
  return {
    readPage: vi.fn(async (_tx: CoverageTx, _cid: string, after: string | null, limit: number) => {
      const start = after === null ? 0 : sorted.findIndex((row) => row.lineId > after);
      const from = start === -1 ? sorted.length : start;
      const page = sorted.slice(from, from + limit);
      const last = page.at(-1);
      const more = from + page.length < sorted.length;
      return { rows: page, nextAfter: page.length === limit && more && last ? last.lineId : null };
    }),
  };
}

function salaryReader(rows: readonly SalaryRow[]) {
  const sorted = [...rows].sort((left, right) => {
    if (left.employeeId !== right.employeeId) return left.employeeId < right.employeeId ? -1 : 1;
    return left.effectiveFrom < right.effectiveFrom ? -1 : 1;
  });
  const after = (row: SalaryRow, cursor: SalaryCoverageCursor): boolean =>
    row.employeeId > cursor.employeeId ||
    (row.employeeId === cursor.employeeId && row.effectiveFrom > cursor.effectiveFrom);
  return {
    readPage: vi.fn(
      async (_tx: CoverageTx, _cid: string, cursor: SalaryCoverageCursor | null, limit: number) => {
        const start = cursor === null ? 0 : sorted.findIndex((row) => after(row, cursor));
        const from = start === -1 ? sorted.length : start;
        const page = sorted.slice(from, from + limit);
        const last = page.at(-1);
        const more = from + page.length < sorted.length;
        return {
          rows: page,
          next:
            page.length === limit && more && last
              ? { employeeId: last.employeeId, effectiveFrom: last.effectiveFrom }
              : null,
        };
      },
    ),
  };
}

function projectionReader(options: {
  readonly lines?: readonly LineRow[];
  readonly salaries?: readonly SalaryRow[];
  readonly marked?: ReadonlySet<string>;
}) {
  const lineMap = new Map((options.lines ?? []).map((row) => [row.lineId, row]));
  const salaryMap = new Map<string, SalaryRow[]>();
  for (const row of options.salaries ?? []) {
    salaryMap.set(row.employeeId, [...(salaryMap.get(row.employeeId) ?? []), row]);
  }
  const marked = options.marked ?? new Set<string>();
  return {
    lineRevisions: vi.fn(async (_tx: CoverageTx, _cid: string, ids: readonly string[]) =>
      ids.map((id) => lineMap.get(id)).filter((row): row is LineRow => row !== undefined),
    ),
    salaryRevisions: vi.fn(async (_tx: CoverageTx, _cid: string, ids: readonly string[]) =>
      ids.flatMap((id) => salaryMap.get(id) ?? []),
    ),
    markedEventIds: vi.fn(
      async (_tx: CoverageTx, _cid: string, _consumer: string, ids: readonly string[]) =>
        new Set(ids.filter((id) => marked.has(id))),
    ),
  };
}

function retainedReader(events: readonly ClaimedEvent[]) {
  const sorted = [...events].sort((left, right) => (left.id < right.id ? -1 : 1));
  return {
    // الحد الأعلى بيتحدد من أول صفحة ويتعاد زي ما هو، فالقارئ بيرد بنفس الحد اللي اتبعت.
    commissionInputReplayPage: vi.fn(
      async (_cid: string, afterId: string | null, throughId: string | null, limit: number) => {
        const end = throughId ?? sorted.at(-1)?.id ?? null;
        if (end === null) return { throughId: null, events: [] };
        const page = sorted.filter((item) => item.id > (afterId ?? '') && item.id <= end);
        return { throughId: end, events: page.slice(0, limit) };
      },
    ),
  };
}

interface HarnessOptions {
  readonly sourceLines?: readonly LineRow[];
  readonly projectedLines?: readonly LineRow[];
  readonly sourceSalaries?: readonly SalaryRow[];
  readonly projectedSalaries?: readonly SalaryRow[];
  readonly events?: readonly ClaimedEvent[];
  readonly marked?: ReadonlySet<string>;
}

function harness(options: HarnessOptions) {
  const tenants: string[] = [];
  const withTenant: CoverageTenantRunner = async <T>(
    companyId: string,
    fn: (tx: CoverageTx) => Promise<T>,
  ): Promise<T> => {
    tenants.push(companyId);
    return fn(DUMMY_TX);
  };
  const lines = lineReader(options.sourceLines ?? []);
  const salaries = salaryReader(options.sourceSalaries ?? []);
  const projection = projectionReader({
    lines: options.projectedLines ?? options.sourceLines ?? [],
    salaries: options.projectedSalaries ?? options.sourceSalaries ?? [],
    marked: options.marked ?? new Set<string>(),
  });
  const retained = retainedReader(options.events ?? []);
  const deps: CommissionCoverageDeps = {
    withTenant,
    lines,
    salaries,
    projection,
    retained,
    consumerId: CONSUMER,
  };
  return { deps, tenants, lines, salaries, projection, retained };
}

const run = (deps: CommissionCoverageDeps, throughId: string | null = null, companyId = COMPANY) =>
  runCommissionCoverageReport(deps, { companyId, throughId });

describe('runCommissionCoverageReport: the coverage comparison', () => {
  it('reports COVERED with exact counts and empty lists when everything is covered', async () => {
    const events = [event(1), event(2, 'SalaryChanged')];
    const { deps, tenants } = harness({
      sourceLines: [line(1, 2), line(2, 5)],
      sourceSalaries: [salary('emp-1', '2026-01-31', 1)],
      events,
      marked: allMarked(events),
    });
    const report = await run(deps, null, COMPANY.toUpperCase());
    expect(report.status).toBe('COVERED');
    expect(report.lines.checked).toBe(2);
    expect(report.lines.missing).toEqual({ total: 0, ids: [] });
    expect(report.lines.stale).toEqual({ total: 0, ids: [] });
    expect(report.salaries.checked).toBe(1);
    expect(report.salaries.missing).toEqual({ total: 0, ids: [] });
    expect(report.salaries.stale).toEqual({ total: 0, ids: [] });
    expect(report.unmarked).toEqual({ checked: 2, total: 0, events: [] });
    expect(report.truncated).toBe(false);
    expect([...new Set(tenants)]).toEqual([COMPANY]);
  });
  it('counts a missing line, a stale line and a line the projection covers ahead', async () => {
    const { deps } = harness({
      sourceLines: [line(1, 1), line(2, 4), line(3, 1)],
      projectedLines: [line(2, 2), line(3, 9)],
    });
    const report = await run(deps);
    expect(report.status).toBe('NOT_COVERED');
    expect(report.lines.checked).toBe(3);
    expect(report.lines.missing).toEqual({ total: 1, ids: [lineId(1)] });
    expect(report.lines.stale).toEqual({ total: 1, ids: [lineId(2)] });
  });
  it('keys each salary by employee and date and judges every date apart', async () => {
    const { deps } = harness({
      sourceSalaries: [
        salary('emp-1', '2026-01-31', 1),
        salary('emp-2', '2026-02-28', 3),
        salary('emp-1', '2026-02-28', 1),
      ],
      projectedSalaries: [salary('emp-2', '2026-02-28', 1), salary('emp-1', '2026-02-28', 1)],
    });
    const report = await run(deps);
    expect(report.salaries.checked).toBe(3);
    expect(report.salaries.missing).toEqual({ total: 1, ids: ['emp-1|2026-01-31'] });
    expect(report.salaries.stale).toEqual({ total: 1, ids: ['emp-2|2026-02-28'] });
  });
});

describe('runCommissionCoverageReport: the retained events and the paging', () => {
  it('lists the unmarked retained events with their type and fails coverage', async () => {
    const events = [
      event(1, 'ServiceSessionRecorded'),
      event(2, 'ServiceSessionLinesAdded'),
      event(3, 'SalaryChanged'),
    ];
    const { deps } = harness({ events, marked: new Set([eventId(2)]) });
    const report = await run(deps);
    expect(report.status).toBe('NOT_COVERED');
    expect(report.unmarked.checked).toBe(3);
    expect(report.unmarked.total).toBe(2);
    expect(report.unmarked.events).toEqual([
      { eventId: eventId(1), type: 'ServiceSessionRecorded' },
      { eventId: eventId(3), type: 'SalaryChanged' },
    ]);
  });
  it('checks every source line across the pages of a 450-line source', async () => {
    const { deps, lines } = harness({ sourceLines: sourceLines(450) });
    const report = await run(deps);
    expect(report.lines.checked).toBe(450);
    expect(report.lines.missing.total).toBe(0);
    expect(report.lines.stale.total).toBe(0);
    expect(lines.readPage).toHaveBeenCalledTimes(3);
  });
  it('checks every retained event across the pages of a 250-event source', async () => {
    const events = Array.from({ length: 250 }, (_, index) => event(index + 1));
    const { deps, retained } = harness({ events, marked: allMarked(events) });
    const report = await run(deps);
    expect(report.unmarked.checked).toBe(250);
    expect(report.unmarked.total).toBe(0);
    expect(retained.commissionInputReplayPage).toHaveBeenCalledTimes(3);
  });
  it.each([
    { count: 250, truncated: true },
    { count: 200, truncated: false },
  ])('caps the missing line ids at 200 for a $count-line source', async ({ count, truncated }) => {
    const { deps } = harness({ sourceLines: sourceLines(count), projectedLines: [] });
    const report = await run(deps);
    expect(report.lines.missing.total).toBe(count);
    expect(report.lines.missing.ids).toHaveLength(200);
    expect(report.truncated).toBe(truncated);
  });
});

describe('runCommissionCoverageReport: the scope and the report content', () => {
  it('keeps the first retained page throughId as the fixed upper bound', async () => {
    const events = Array.from({ length: 150 }, (_, index) => event(index + 1));
    const { deps, retained } = harness({ events, marked: allMarked(events) });
    const report = await run(deps);
    const page = retained.commissionInputReplayPage;
    expect(page).toHaveBeenNthCalledWith(1, COMPANY, null, null, 100);
    expect(page).toHaveBeenNthCalledWith(2, COMPANY, eventId(100), eventId(150), 100);
    expect(report.throughId).toBe(eventId(150));
  });
  it('passes the requested scope throughId on the first retained page', async () => {
    const events = Array.from({ length: 150 }, (_, index) => event(index + 1));
    const { deps, retained } = harness({ events, marked: allMarked(events) });
    const report = await run(deps, eventId(120));
    const page = retained.commissionInputReplayPage;
    expect(page).toHaveBeenNthCalledWith(1, COMPANY, null, eventId(120), 100);
    expect(report.throughId).toBe(eventId(120));
    expect(report.unmarked.checked).toBe(120);
  });
  it('rejects a retained event of another company', async () => {
    const { deps } = harness({ events: [event(1, 'ServiceSessionRecorded', OTHER)] });
    const failure = await run(deps).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CommissionCoverageEventInvalidError);
    expect((failure as CommissionCoverageEventInvalidError).code).toBe(
      'COMMISSION_COVERAGE_EVENT_INVALID',
    );
  });
  it('keeps the event payload out of the report', async () => {
    const { deps } = harness({ events: [event(1), event(2)] });
    const report = await run(deps);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('payload');
    expect(serialized).not.toContain('leak-me');
  });
});
