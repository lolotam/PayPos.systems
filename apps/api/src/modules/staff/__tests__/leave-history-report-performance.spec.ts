import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { performance } from 'node:perf_hooks';
import {
  leaveHistoryCursorData,
  leaveHistoryPage,
  leaveHistoryReportQuery,
  type LeaveHistoryCursorData,
  type LeaveHistoryReportQuery,
} from '@pospay/contracts';
import { decodeCursor } from '../../../shared/persistence/name-options-cursor.ts';
import { createLeaveReadAccess } from '../persistence/leave-read-access.adapter.ts';
import { leaveHistorySql } from '../queries/leave-history.query.ts';
import {
  historyLeaveWorkloadSql,
  historyWorkloadSql,
} from '../queries/leave-history-workload.sql.ts';
import {
  getBusinessLeaveHistory,
  LEAVE_HISTORY_SYNC_LEAVES,
  LEAVE_HISTORY_SYNC_SHIFTS,
} from '../queries/leave-history-report.query.ts';
import { historySyncLimits, leaveFixture, type LeaveFixture } from './leave-history.fixture.ts';
import { seedHistoryVolume } from './leave-history-performance.fixture.ts';

let f: LeaveFixture;
let case7Cursor: string;
let case7DecodedCursor: LeaveHistoryCursorData;

const access = createLeaveReadAccess({ now: () => new Date('2026-11-07T10:00:00.000Z') });

beforeAll(async () => {
  f = await leaveFixture({ hireDate: '2025-01-01' });
  await seedHistoryVolume(f);
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

// plan D6: the indexed tables the report and its counts read.
const indexedTables = [
  'leave_requests',
  'attendance_sessions',
  'employees',
  'staff_schedules',
  'staff_schedule_shifts',
];

function assertNoSeqScan(plan: unknown): void {
  const node = plan as { 'Node Type'?: string; 'Relation Name'?: string; Plans?: unknown[] };
  if (node['Node Type'] === 'Seq Scan') {
    expect(indexedTables).not.toContain(node['Relation Name']);
  }
  for (const child of node.Plans ?? []) {
    assertNoSeqScan(child);
  }
}

async function explainWorkload(q: { from: string; to: string }) {
  const result = await f.db.withTenant(f.company, async (tx) => {
    const context = {
      companyId: f.company,
      userId: f.userId,
      businessId: f.business,
      own: false,
    };
    const scope = await access.check(tx, context);
    if (!scope) throw new Error('Performance scope missing');
    const statement = historyWorkloadSql(context, scope, q, LEAVE_HISTORY_SYNC_SHIFTS);
    return tx.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`);
  });
  const raw = result[0]?.['QUERY PLAN'] as [{ Plan: unknown; 'Execution Time': number }];
  const root = raw[0];
  if (!root) throw new Error('Missing EXPLAIN JSON');
  expect(root['Execution Time']).toBeLessThanOrEqual(200);
  assertNoSeqScan(root.Plan);
}

async function explainStatement(q: LeaveHistoryReportQuery, cursor?: LeaveHistoryCursorData) {
  const result = await f.db.withTenant(f.company, async (tx) => {
    const context = {
      companyId: f.company,
      userId: f.userId,
      businessId: f.business,
      own: false,
      ...(q.employee_id === undefined ? {} : { employeeId: q.employee_id }),
    };
    const scope = await access.check(tx, {
      ...context,
      ...(q.employee_id !== undefined ? { purpose: 'history' as const } : {}),
    });
    if (!scope) throw new Error('Performance scope missing');
    const asOf = cursor?.as_of ?? scope.now.toISOString();
    const statement = leaveHistorySql(context, q, scope, {
      asOf,
      excludeOpen: false,
      report: { attachment: 'current' },
      ...(cursor ? { cursor } : {}),
    });
    return tx.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`);
  });
  const raw = result[0]?.['QUERY PLAN'] as [{ Plan: unknown; 'Execution Time': number }];
  const root = raw[0];
  if (!root) throw new Error('Missing EXPLAIN JSON');
  expect(root['Execution Time']).toBeLessThanOrEqual(200);
  assertNoSeqScan(root.Plan);
}

async function measureHttpP95(urlQuery: string) {
  const read = async () => {
    const result = await f.h.app.inject({
      method: 'GET',
      url: `/v1/businesses/${f.business}/leave-history?${urlQuery}`,
      headers: { cookie: f.cookie, 'x-company-id': f.company },
    });
    expect(result.statusCode).toBe(200);
    return leaveHistoryPage.parse(result.json());
  };

  const page = await read();
  expect(page.items).toBeDefined();

  for (let n = 0; n < 5; n++) await read();

  const samples: number[] = [];
  for (let n = 0; n < 50; n++) {
    const start = performance.now();
    await read();
    samples.push(performance.now() - start);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = sorted[Math.ceil(samples.length * 0.95) - 1] ?? 0;
  expect(p95).toBeLessThanOrEqual(200);
  return page;
}

async function measureRefusalP95(urlQuery: string) {
  const read = async () => {
    const result = await f.h.app.inject({
      method: 'GET',
      url: `/v1/businesses/${f.business}/leave-history?${urlQuery}`,
      headers: { cookie: f.cookie, 'x-company-id': f.company },
    });
    expect(result.statusCode).toBe(422);
    const body = result.json();
    expect(body.code).toBe('LEAVE_HISTORY_REPORT_REQUIRED');
    expect(typeof body.message_ar).toBe('string');
    expect(body.message_ar.length).toBeGreaterThan(0);
    expect(typeof body.message_en).toBe('string');
    expect(body.message_en.length).toBeGreaterThan(0);
    return body;
  };

  await read();

  for (let n = 0; n < 5; n++) await read();

  const samples: number[] = [];
  for (let n = 0; n < 50; n++) {
    const start = performance.now();
    await read();
    samples.push(performance.now() - start);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = sorted[Math.ceil(samples.length * 0.95) - 1] ?? 0;
  expect(p95).toBeLessThanOrEqual(200);
}

it('performance case 1 (refused): unfiltered full year', async () => {
  await measureRefusalP95('from=2025-11-07&to=2026-11-06');
});

it('performance case workload explain (refused): full year 2025-11-07..2026-11-06', async () => {
  await explainWorkload({ from: '2025-11-07', to: '2026-11-06' });
});

it('performance case 7 (fast): a one-month range', async () => {
  const query = leaveHistoryReportQuery.parse({
    from: '2026-10-01',
    to: '2026-10-31',
    limit: 20,
  });
  await explainStatement(query);
  const page = await measureHttpP95('from=2026-10-01&to=2026-10-31&limit=20');
  expect(page.next_cursor).not.toBeNull();
  case7Cursor = page.next_cursor as string;
  case7DecodedCursor = decodeCursor(case7Cursor, (v) => leaveHistoryCursorData.parse(v));
});

it('performance case 2 (fast): second page of case 7', async () => {
  expect(case7Cursor).toBeDefined();
  const query = leaveHistoryReportQuery.parse({
    from: '2026-10-01',
    to: '2026-10-31',
    cursor: case7Cursor,
    limit: 20,
  });
  await explainStatement(query, case7DecodedCursor);
  await measureHttpP95(
    `from=2026-10-01&to=2026-10-31&cursor=${encodeURIComponent(case7Cursor)}&limit=20`,
  );
});

it('performance case 3 (fast): employee_id full year', async () => {
  const query = leaveHistoryReportQuery.parse({
    from: '2025-11-07',
    to: '2026-11-06',
    employee_id: f.employee.id,
  });
  await explainStatement(query);
  await measureHttpP95(`from=2025-11-07&to=2026-11-06&employee_id=${f.employee.id}`);
});

it('performance case 4 (refused): types[]=UNEXCUSED_ABSENCE', async () => {
  await measureRefusalP95('from=2025-11-07&to=2026-11-06&types[]=UNEXCUSED_ABSENCE');
});

it('performance case 5 (fast): types[]=ANNUAL', async () => {
  const query = leaveHistoryReportQuery.parse({
    from: '2025-11-07',
    to: '2026-11-06',
    'types[]': ['ANNUAL'],
  });
  await explainStatement(query);
  await measureHttpP95('from=2025-11-07&to=2026-11-06&types[]=ANNUAL');
});

it('performance case 6 (refused): branch_id', async () => {
  await measureRefusalP95(`from=2025-11-07&to=2026-11-06&branch_id=${f.branch}`);
});

it('performance case over-limit (refused): 2026-09-21..2026-10-31', async () => {
  await measureRefusalP95('from=2026-09-21&to=2026-10-31');
});

it('performance case at-limit (fast): 2026-09-22..2026-10-31', async () => {
  const query = leaveHistoryReportQuery.parse({
    from: '2026-09-22',
    to: '2026-10-31',
  });
  await explainWorkload(query);
  await explainStatement(query);
  await measureHttpP95('from=2026-09-22&to=2026-10-31');
});

it('performance case (fast): statuses[]=PENDING full year', async () => {
  const query = leaveHistoryReportQuery.parse({
    from: '2025-11-07',
    to: '2026-11-06',
    'statuses[]': ['PENDING'],
  });
  await explainStatement(query);
  await measureHttpP95('from=2025-11-07&to=2026-11-06&statuses[]=PENDING');
});

it('performance case at-limit with split shifts (fast): 4 shifts a day 2026-06-01..2026-06-10', async () => {
  await f.h.owner`
    INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at)
    SELECT
      sc.company_id,
      gen_random_uuid(),
      sc.id,
      sc.employee_id,
      d.day,
      (extract(dow FROM d.day)::int + 1) % 7,
      times.s,
      times.e,
      (d.day + times.s::time) AT TIME ZONE 'UTC',
      (d.day + times.e::time) AT TIME ZONE 'UTC'
    FROM generate_series(date '2026-06-01', date '2026-06-10', interval '1 day') AS g(ts)
    CROSS JOIN LATERAL (SELECT g.ts::date AS day) d
    CROSS JOIN (
      VALUES ('00:00', '02:00'), ('02:30', '04:30'), ('05:00', '07:00')
    ) AS times(s, e)
    JOIN staff_schedules sc ON sc.company_id=${f.company}
      AND sc.branch_id=${f.branch}
      AND sc.week_start = d.day - ((extract(dow FROM d.day)::int + 1) % 7)
  `;

  const count = await f.db.withTenant(f.company, async (tx) => {
    const scope = await access.check(tx, {
      companyId: f.company,
      userId: f.userId,
      businessId: f.business,
      own: false,
    });
    if (!scope) throw new Error('Scope missing');
    const [row] = await tx.execute<{ shifts: number }>(
      historyWorkloadSql(
        { companyId: f.company, userId: f.userId, businessId: f.business, own: false },
        scope,
        { from: '2026-06-01', to: '2026-06-10' },
        LEAVE_HISTORY_SYNC_SHIFTS,
      ),
    );
    return row?.shifts;
  });
  expect(count).toBe(2000);

  const query = leaveHistoryReportQuery.parse({ from: '2026-06-01', to: '2026-06-10' });
  await explainStatement(query);
  await measureHttpP95('from=2026-06-01&to=2026-06-10');
});

const reportContext = () => ({
  companyId: f.company,
  userId: f.userId,
  businessId: f.business,
  own: false,
});

async function leaveWorkload(q: LeaveHistoryReportQuery, explain: boolean) {
  return f.db.withTenant(f.company, async (tx) => {
    const scope = await access.check(tx, reportContext());
    if (!scope) throw new Error('Performance scope missing');
    const statement = historyLeaveWorkloadSql(
      reportContext(),
      q,
      scope,
      { asOf: scope.now.toISOString(), visibility: 'current' },
      LEAVE_HISTORY_SYNC_LEAVES,
    );
    return explain
      ? tx.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`)
      : tx.execute(statement);
  });
}

it('performance case leave workload explain: statuses[]=APPROVED full year', async () => {
  const query = leaveHistoryReportQuery.parse({
    from: '2025-11-07',
    to: '2026-11-06',
    'statuses[]': ['APPROVED'],
  });
  const result = await leaveWorkload(query, true);
  const raw = result[0]?.['QUERY PLAN'] as [{ Plan: unknown; 'Execution Time': number }];
  const root = raw[0];
  if (!root) throw new Error('Missing EXPLAIN JSON');
  expect(root['Execution Time']).toBeLessThanOrEqual(200);
  assertNoSeqScan(root.Plan);
});

it('performance case leave cap: refused one row under the leave count, fast at it', async () => {
  const query = leaveHistoryReportQuery.parse({
    from: '2025-11-07',
    to: '2026-11-06',
    'statuses[]': ['APPROVED'],
  });
  const [row] = await leaveWorkload(query, false);
  const leaves = Number(row?.['leaves']);
  expect(leaves).toBeGreaterThan(0);
  expect(leaves).toBeLessThanOrEqual(LEAVE_HISTORY_SYNC_LEAVES);

  const read = (cap: number) =>
    f.db.withTenant(f.company, (tx) =>
      getBusinessLeaveHistory(tx, reportContext(), query, access, {
        ...historySyncLimits,
        leaves: cap,
      }),
    );
  expect(await read(leaves - 1)).toBe('LEAVE_HISTORY_REPORT_REQUIRED');
  const page = await read(leaves);
  expect(page).not.toBeNull();
  expect(typeof page).toBe('object');
  await explainStatement(query);
});
