import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  BuildLeaveHistoryReport,
  LeaveHistoryReportRetryError,
} from '../use-cases/build-leave-history-report/build-leave-history-report.ts';
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

const real = () => leaveHistoryReportTransactions(f.db, 60_000);
const failingBuild = (error: unknown) => ({
  ...real(),
  build: async () => {
    throw error;
  },
});
const execute = (id: string, transactions = real()) =>
  new BuildLeaveHistoryReport(transactions).execute(f.company, id);

it.each([
  { name: 'TimeoutError' },
  { name: 'QueryCanceled', code: '57014' },
  { name: 'IdleInTransactionSessionTimeout', code: '25P03' },
])('marks $name/$code failed without retrying', async ({ name, code }) => {
  const id = await f.pendingReport();
  const error = Object.assign(new Error('private driver detail'), { name, code });
  await expect(execute(id, failingBuild(error))).resolves.toBeUndefined();
  expect((await f.report(id))[0]).toMatchObject({
    status: 'failed',
    error_code: 'LEAVE_HISTORY_REPORT_FAILED',
  });
  expect(await f.rows(id)).toHaveLength(0);
});

it('accepts a ready result when the commit reply is unknown', async () => {
  const id = await f.pendingReport();
  await execute(id);
  const [before] = await f.report(id);
  const error = Object.assign(new Error('lost commit'), { name: 'CommitOutcomeUnknownError' });
  await expect(execute(id, failingBuild(error))).resolves.toBeUndefined();
  expect((await f.report(id))[0]?.['computed_at']).toEqual(before?.['computed_at']);
  expect(await f.rows(id)).toHaveLength(5);
});

it('accepts a failed result when the commit reply is unknown', async () => {
  const id = await f.pendingReport({ query: { invalid: true } });
  await execute(id);
  const error = Object.assign(new Error('lost commit'), { name: 'CommitOutcomeUnknownError' });
  await expect(execute(id, failingBuild(error))).resolves.toBeUndefined();
  expect((await f.report(id))[0]).toMatchObject({
    status: 'failed',
    error_code: 'LEAVE_HISTORY_REPORT_FAILED',
  });
  expect(await f.rows(id)).toHaveLength(0);
});

it('retries an unknown commit only while the report remains pending', async () => {
  const id = await f.pendingReport();
  const error = Object.assign(new Error('lost commit'), { name: 'CommitOutcomeUnknownError' });
  await expect(execute(id, failingBuild(error))).rejects.toBeInstanceOf(
    LeaveHistoryReportRetryError,
  );
  expect((await f.report(id))[0]?.['status']).toBe('pending');
  expect(await f.rows(id)).toHaveLength(0);
});

it('retries an unknown error without carrying the driver message', async () => {
  const id = await f.pendingReport();
  const error = await execute(id, failingBuild(new Error('sensitive driver message'))).catch(
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(LeaveHistoryReportRetryError);
  expect(error).toMatchObject({ message: 'LEAVE_HISTORY_REPORT_RETRY', failureCode: undefined });
  expect(JSON.stringify(error)).not.toContain('sensitive driver message');
  expect((await f.report(id))[0]?.['status']).toBe('pending');
});

it('returns the permanent code for retry when the failure write is unavailable', async () => {
  const id = await f.pendingReport({ query: { invalid: true } });
  const transactions = {
    ...real(),
    fail: async () => {
      throw new Error('private failure-write detail');
    },
  };
  const error = await execute(id, transactions).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(LeaveHistoryReportRetryError);
  expect(error).toMatchObject({ failureCode: 'LEAVE_HISTORY_REPORT_FAILED' });
  expect(JSON.stringify(error)).not.toContain('private failure-write detail');
  expect((await f.report(id))[0]?.['status']).toBe('pending');
});

it('never turns failed ready or ready failed', async () => {
  const failedId = await f.pendingReport({ query: { invalid: true } });
  await execute(failedId);
  await execute(failedId);
  expect((await f.report(failedId))[0]?.['status']).toBe('failed');

  const readyId = await f.pendingReport();
  const useCase = new BuildLeaveHistoryReport(real());
  await useCase.execute(f.company, readyId);
  await useCase.fail(f.company, readyId);
  expect((await f.report(readyId))[0]).toMatchObject({ status: 'ready', row_count: 5 });
  expect(await f.rows(readyId)).toHaveLength(5);
});

it('hands the failure log company, report and creator ids and no driver text', async () => {
  const id = await f.pendingReport();
  const [row] = await f.report(id);
  const seen: unknown[] = [];
  const error = Object.assign(new Error('private driver detail'), { name: 'TimeoutError' });
  await new BuildLeaveHistoryReport(failingBuild(error), {
    failed: (context) => seen.push(context),
  }).execute(f.company, id);
  expect(seen).toEqual([
    {
      companyId: f.company,
      reportId: id,
      createdBy: row?.['created_by'],
      code: 'LEAVE_HISTORY_REPORT_FAILED',
    },
  ]);
  expect(JSON.stringify(seen)).not.toContain('private driver detail');
});
