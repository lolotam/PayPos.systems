import { afterAll, beforeAll, expect, it } from 'vitest';
import { historyRows, type HistoryScope, type LeaveHistoryContext } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { BuildLeaveHistoryReport } from '../use-cases/build-leave-history-report/build-leave-history-report.ts';
import { leaveHistoryReportTransactions } from '../persistence/leave-history-report.transactions.ts';
import {
  leaveHistoryReportFixture,
  type LeaveHistoryReportFixture,
} from './leave-history-report.fixture.ts';

let f: LeaveHistoryReportFixture;
beforeAll(async () => {
  f = await leaveHistoryReportFixture();
});
afterAll(async () => {
  await f?.close();
});

const approvedOnly = () => f.query({ 'types[]': ['ANNUAL'], 'statuses[]': ['APPROVED'] });
const build = (reportId: string, cap = 2) =>
  new BuildLeaveHistoryReport(leaveHistoryReportTransactions(f.db, 60_000, cap)).execute(
    f.company,
    reportId,
  );

// PP-179: the cap is injected, so this proves the boundary without a 25,000-row fixture.
it('builds exactly at the cap and refuses cap+1 before inserting any rows', async () => {
  const exact = await f.pendingReport({ query: approvedOnly() });
  await build(exact);
  expect((await f.report(exact))[0]).toMatchObject({ status: 'ready', row_count: 2 });
  expect(await f.rows(exact)).toHaveLength(2);

  await f.leave({ employeeId: f.employees.absent, date: '2026-11-01' });
  const over = await f.pendingReport({ query: approvedOnly() });
  await build(over);
  expect((await f.report(over))[0]).toMatchObject({
    status: 'failed',
    error_code: 'LEAVE_HISTORY_REPORT_TOO_LARGE',
    row_count: 0,
  });
  expect(await f.rows(over)).toHaveLength(0);
});

it('uses indexes instead of sequential scans in the bounded pre-count plan', async () => {
  const context: LeaveHistoryContext = {
    companyId: f.company,
    userId: f.createdBy,
    businessId: f.business,
    own: false,
  };
  const scope: HistoryScope = {
    ...f.scope(),
    now: f.clock.value,
    eligibilityDays: [
      { branchId: f.branch, today: '2026-11-07' },
      { branchId: f.secondBranch, today: '2026-11-07' },
    ],
  };
  const prefix = historyRows(context, { ...f.query(), limit: 3 }, scope, {
    asOf: f.clock.value.toISOString(),
    excludeOpen: false,
    visibility: 'current',
  });
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (FORMAT JSON) ${prefix}
      SELECT count(*)::int AS row_count FROM (SELECT 1 FROM rows LIMIT 3) candidates`);
  });
  const nodes = planNodes(plan);
  const tables = [
    'leave_requests',
    'staff_schedule_shifts',
    'attendance_sessions',
    'staff_schedules',
    'employees',
  ];
  for (const table of tables) {
    expect(
      nodes.some((node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === table),
      table,
    ).toBe(false);
  }
  for (const table of ['leave_requests', 'staff_schedule_shifts']) {
    expect(
      nodes.some(
        (node) => node['Relation Name'] === table && String(node['Node Type']).includes('Index'),
      ),
      table,
    ).toBe(true);
  }
});

function planNodes(value: unknown): Record<string, unknown>[] {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(planNodes);
  const node = value as Record<string, unknown>;
  return [node, ...Object.values(node).flatMap(planNodes)];
}
