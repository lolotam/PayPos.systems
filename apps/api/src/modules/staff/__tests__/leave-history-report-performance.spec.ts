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
import { leaveFixture, type LeaveFixture } from './leave-history.fixture.ts';
import { seedHistoryVolume } from './leave-history-performance.fixture.ts';

let f: LeaveFixture;
let pageOneCursor: string;
let pageOneDecodedCursor: LeaveHistoryCursorData;

const access = createLeaveReadAccess({ now: () => new Date('2026-11-07T10:00:00.000Z') });

beforeAll(async () => {
  f = await leaveFixture({ hireDate: '2025-01-01' });
  await seedHistoryVolume(f);
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

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

it('performance case 1: unfiltered full year first page', async () => {
  const query = leaveHistoryReportQuery.parse({ from: '2025-11-07', to: '2026-11-06' });
  await explainStatement(query);
  const page = await measureHttpP95('from=2025-11-07&to=2026-11-06');
  expect(page.next_cursor).not.toBeNull();
  pageOneCursor = page.next_cursor as string;
  pageOneDecodedCursor = decodeCursor(pageOneCursor, (v) => leaveHistoryCursorData.parse(v));
});

it('performance case 2: unfiltered second page (cursor from the first)', async () => {
  expect(pageOneCursor).toBeDefined();
  const query = leaveHistoryReportQuery.parse({
    from: '2025-11-07',
    to: '2026-11-06',
    cursor: pageOneCursor,
  });
  await explainStatement(query, pageOneDecodedCursor);
  await measureHttpP95(`from=2025-11-07&to=2026-11-06&cursor=${encodeURIComponent(pageOneCursor)}`);
});

it('performance case 3: employee_id full year', async () => {
  const query = leaveHistoryReportQuery.parse({
    from: '2025-11-07',
    to: '2026-11-06',
    employee_id: f.employee.id,
  });
  await explainStatement(query);
  await measureHttpP95(`from=2025-11-07&to=2026-11-06&employee_id=${f.employee.id}`);
});

it('performance case 4: types[]=UNEXCUSED_ABSENCE', async () => {
  const query = leaveHistoryReportQuery.parse({
    from: '2025-11-07',
    to: '2026-11-06',
    'types[]': ['UNEXCUSED_ABSENCE'],
  });
  await explainStatement(query);
  await measureHttpP95('from=2025-11-07&to=2026-11-06&types[]=UNEXCUSED_ABSENCE');
});

it('performance case 5: types[]=ANNUAL', async () => {
  const query = leaveHistoryReportQuery.parse({
    from: '2025-11-07',
    to: '2026-11-06',
    'types[]': ['ANNUAL'],
  });
  await explainStatement(query);
  await measureHttpP95('from=2025-11-07&to=2026-11-06&types[]=ANNUAL');
});

it('performance case 6: branch_id', async () => {
  const query = leaveHistoryReportQuery.parse({
    from: '2025-11-07',
    to: '2026-11-06',
    branch_id: f.branch,
  });
  await explainStatement(query);
  await measureHttpP95(`from=2025-11-07&to=2026-11-06&branch_id=${f.branch}`);
});

it('performance case 7: a one-month range', async () => {
  const query = leaveHistoryReportQuery.parse({
    from: '2026-10-01',
    to: '2026-10-31',
  });
  await explainStatement(query);
  await measureHttpP95('from=2026-10-01&to=2026-10-31');
});
