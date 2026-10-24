import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceStatementScheduledEmployeesStatement } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { monthlyReportLoadFixture } from './attendance-monthly-report-load.fixture.ts';
import type { MonthlyReportFixture } from './attendance-monthly-report.fixture.ts';

let f: MonthlyReportFixture;
beforeAll(async () => { f = await monthlyReportLoadFixture(4); });
afterAll(async () => { await f?.db.close(); await f?.h.close(); });

const statement = () => attendanceStatementScheduledEmployeesStatement(
  f.company, f.business, { id: f.branch, timezone: 'Asia/Kuwait' }, '2026-10-01', '2026-10-31');

it('the statement returns every scheduled employee of the load fixture', async () => {
  const rows = await f.db.withTenant(f.company, (tx) => tx.execute(statement()));
  expect(rows).toHaveLength(60);
});

it('EXPLAIN ANALYZE reads the schedule and its shifts through their indexes', async () => {
  const plans = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) ${statement()}`);
  });
  const plan = JSON.stringify(plans);
  expect(plan).toMatch(/staff_schedules_branch_week_idx/);
  expect(plan).toMatch(/staff_schedule_shifts_[a-z_]+/);
});
