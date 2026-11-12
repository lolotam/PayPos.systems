import { afterAll, beforeAll, expect, it } from 'vitest';
import { BuildLeaveHistoryReport } from '../use-cases/build-leave-history-report/build-leave-history-report.ts';
import { CleanLeaveHistoryReports } from '../use-cases/clean-leave-history-reports/clean-leave-history-reports.ts';
import { leaveHistoryReportTransactions } from '../persistence/leave-history-report.transactions.ts';
import { leaveHistoryReportCleanupTransactions } from '../persistence/leave-history-report-cleanup.transactions.ts';
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

const EXPIRED = new Date('2026-11-08T00:00:00.000Z');
const cleanup = () => new CleanLeaveHistoryReports(leaveHistoryReportCleanupTransactions(f.db, 30_000));
const build = (id: string) =>
  new BuildLeaveHistoryReport(leaveHistoryReportTransactions(f.db, 60_000)).execute(f.company, id);

it('deletes only expired reports of its company and cascades their rows', async () => {
  const expired = await f.pendingReport({ expiresAt: EXPIRED });
  await build(expired);
  expect(await f.rows(expired)).toHaveLength(5);
  const fresh = await f.pendingReport();
  const foreign = await f.pendingReport({
    companyId: f.otherCompany,
    businessId: f.otherBusiness,
    expiresAt: EXPIRED,
  });

  await cleanup().execute(f.company);

  expect(await f.report(expired)).toHaveLength(0);
  expect(await f.rows(expired)).toHaveLength(0);
  expect((await f.report(fresh))[0]?.['status']).toBe('pending');
  expect((await f.report(foreign))[0]?.['status']).toBe('pending');
});

it('skips a report locked by another connection and removes it after release', async () => {
  const id = await f.pendingReport({ expiresAt: EXPIRED });
  const blocker = await f.owner.reserve();
  try {
    await blocker`BEGIN`;
    await blocker`SELECT id FROM leave_history_reports WHERE id=${id} FOR UPDATE`;
    await cleanup().execute(f.company);
    expect(await f.report(id)).toHaveLength(1);
    await blocker`COMMIT`;
    await cleanup().execute(f.company);
    expect(await f.report(id)).toHaveLength(0);
  } finally {
    await blocker`ROLLBACK`.catch(() => undefined);
    blocker.release();
  }
});

it('drains more than two expired reports in one execute', async () => {
  const ids: string[] = [];
  for (let index = 0; index < 5; index += 1)
    ids.push(await f.pendingReport({ expiresAt: EXPIRED }));
  await cleanup().execute(f.company);
  expect(await f.owner`SELECT id FROM leave_history_reports WHERE id=ANY(${ids})`).toHaveLength(0);
});
