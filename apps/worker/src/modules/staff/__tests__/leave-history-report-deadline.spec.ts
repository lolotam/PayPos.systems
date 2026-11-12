import { afterAll, beforeAll, expect, it } from 'vitest';
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

const build = (id: string) =>
  new BuildLeaveHistoryReport(leaveHistoryReportTransactions(f.db, 60_000)).execute(f.company, id);

async function databaseNow() {
  const [row] = await f.owner`SELECT now() AS now`;
  return new Date(row?.['now'] as string);
}

it('fails an already-expired pending report without computing rows', async () => {
  const now = await databaseNow();
  const id = await f.pendingReport({
    asOf: new Date(now.getTime() - 60_000),
    deadlineAt: new Date(now.getTime() - 1_000),
    expiresAt: new Date(now.getTime() + 60_000),
  });
  await build(id);
  expect((await f.report(id))[0]).toMatchObject({
    status: 'failed',
    error_code: 'LEAVE_HISTORY_REPORT_FAILED',
    row_count: 0,
  });
  expect(await f.rows(id)).toHaveLength(0);
});

it('rolls back a build that crosses its deadline before the ready update', async () => {
  // The one pg_sleep seam holds the real insert transaction open past clock_timestamp()'s deadline.
  await f.owner.unsafe(`
    CREATE FUNCTION delay_leave_history_report_insert() RETURNS trigger
      LANGUAGE plpgsql AS $function$
      BEGIN
        PERFORM pg_sleep(0.3);
        RETURN NEW;
      END;
    $function$;
    CREATE TRIGGER delay_leave_history_report_insert BEFORE INSERT ON leave_history_report_rows
      FOR EACH ROW EXECUTE FUNCTION delay_leave_history_report_insert();
  `);
  const now = await databaseNow();
  const id = await f.pendingReport({
    asOf: now,
    deadlineAt: new Date(now.getTime() + 1_000),
    expiresAt: new Date(now.getTime() + 60_000),
  });
  await build(id);
  expect((await f.report(id))[0]).toMatchObject({
    status: 'failed',
    error_code: 'LEAVE_HISTORY_REPORT_FAILED',
    row_count: 0,
  });
  expect(await f.rows(id)).toHaveLength(0);
});
