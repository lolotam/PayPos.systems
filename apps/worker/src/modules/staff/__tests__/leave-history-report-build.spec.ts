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

const build = (reportId: string) =>
  new BuildLeaveHistoryReport(leaveHistoryReportTransactions(f.db, 60_000)).execute(
    f.company,
    reportId,
  );

type StoredRow = {
  seq: number;
  employee_id: string;
  record: {
    id: string;
    employee_id: string;
    row_type: string;
    date?: string;
    from?: string;
    working_date?: string;
    status?: string;
  };
};

it('builds a ready report with contiguous rows in history order', async () => {
  const id = await f.pendingReport();
  await build(id);
  const [report] = await f.report(id);
  const rows = (await f.rows(id)) as unknown as StoredRow[];
  expect(report).toMatchObject({ status: 'ready', row_count: 5, error_code: null });
  expect(report?.['computed_at']).not.toBeNull();
  expect(new Date(report?.['as_of'] as string).toISOString()).toBe(f.clock.value.toISOString());
  expect(rows.map((row) => row.seq)).toEqual([1, 2, 3, 4, 5]);
  for (const row of rows) expect(row.employee_id).toBe(row.record.employee_id);
  const expected = [...rows].sort((left, right) => {
    const date = dateOf(right).localeCompare(dateOf(left));
    if (date !== 0) return date;
    const rank = rankOf(left) - rankOf(right);
    return rank !== 0 ? rank : right.record.id.localeCompare(left.record.id);
  });
  expect(rows.map((row) => row.record.id)).toEqual(expected.map((row) => row.record.id));
});

function dateOf(row: StoredRow) {
  return row.record.date ?? row.record.working_date ?? row.record.from ?? '';
}

function rankOf(row: StoredRow) {
  const ranks: Record<string, number> = { LEAVE: 1, UNEXCUSED_ABSENCE: 2, COVERED_ELSEWHERE: 3 };
  return ranks[row.record.row_type] ?? 0;
}

it('uses the build snapshot for a later approval without moving as_of', async () => {
  const leaveId = await f.leave({
    employeeId: f.employees.first,
    date: '2026-11-01',
    status: 'PENDING',
  });
  const id = await f.pendingReport();
  await f.owner`UPDATE leave_requests SET status='APPROVED',decided_by=${f.createdBy},decided_at=now()
    WHERE id=${leaveId}`;
  await build(id);
  const rows = (await f.rows(id)) as unknown as StoredRow[];
  expect(rows.find((row) => row.record.id === leaveId)?.record.status).toBe('APPROVED');
  const [report] = await f.report(id);
  expect(new Date(report?.['as_of'] as string).toISOString()).toBe(f.clock.value.toISOString());
});

it('redelivers ready and failed reports without writing another result', async () => {
  const readyId = await f.pendingReport();
  await build(readyId);
  const [readyBefore] = await f.report(readyId);
  await build(readyId);
  const [readyAfter] = await f.report(readyId);
  expect(readyAfter?.['computed_at']).toEqual(readyBefore?.['computed_at']);
  expect(await f.rows(readyId)).toHaveLength(Number(readyBefore?.['row_count']));

  const failedId = await f.pendingReport({ query: { invalid: true } });
  await build(failedId);
  const [failedBefore] = await f.report(failedId);
  await build(failedId);
  const [failedAfter] = await f.report(failedId);
  expect(failedAfter?.['computed_at']).toEqual(failedBefore?.['computed_at']);
  expect(failedAfter).toMatchObject({ status: 'failed', error_code: 'LEAVE_HISTORY_REPORT_FAILED' });
  expect(await f.rows(failedId)).toHaveLength(0);
});

it('treats a missing report as a no-op', async () => {
  const id = f.ids.newId();
  await expect(build(id)).resolves.toBeUndefined();
  expect(await f.report(id)).toHaveLength(0);
  expect(await f.rows(id)).toHaveLength(0);
});

it.each([
  { label: 'query', query: { from: 'bad' } },
  { label: 'scope', scope: { branches: [] } },
])('fails invalid stored $label permanently', async (input) => {
  const id = await f.pendingReport(input);
  await build(id);
  expect((await f.report(id))[0]).toMatchObject({
    status: 'failed',
    error_code: 'LEAVE_HISTORY_REPORT_FAILED',
  });
  expect(await f.rows(id)).toHaveLength(0);
});

it('uses the branch-local date at a UTC midnight eligibility boundary', async () => {
  const employeeId = await f.employee({
    name: 'Honolulu eligibility',
    branchId: f.secondBranch,
    attachments: [{ branchId: f.secondBranch, to: '2026-11-08' }],
  });
  const leaveId = await f.leave({
    employeeId,
    branchId: f.secondBranch,
    date: '2026-11-01',
  });
  const id = await f.pendingReport({
    asOf: new Date('2026-11-07T21:00:00.000Z'),
    scope: f.scope([f.secondBranch]),
    query: f.query({ branch_id: f.secondBranch }),
  });
  await build(id);
  const rows = (await f.rows(id)) as unknown as StoredRow[];
  expect(rows.map((row) => row.record.id)).toEqual([leaveId]);
});

it('drops a branch with an unusable timezone instead of failing the report', async () => {
  const employeeId = await f.employee({
    name: 'Unknown zone eligibility',
    branchId: f.secondBranch,
    attachments: [{ branchId: f.secondBranch }],
  });
  await f.leave({ employeeId, branchId: f.secondBranch, date: '2026-11-01' });
  const id = await f.pendingReport({
    scope: f.scope([f.secondBranch]),
    query: f.query({ branch_id: f.secondBranch }),
  });
  await f.owner`UPDATE branches SET timezone='Not/AZone' WHERE id=${f.secondBranch}`;
  try {
    await build(id);
    expect((await f.report(id))[0]).toMatchObject({ status: 'ready', row_count: 0 });
    expect(await f.rows(id)).toHaveLength(0);
  } finally {
    await f.owner`UPDATE branches SET timezone='Pacific/Honolulu' WHERE id=${f.secondBranch}`;
  }
});

it('sets app.user_id to the stored creator for the build', async () => {
  await f.owner.unsafe(`
    CREATE TABLE leave_history_report_user_probe(report_id uuid, actor_id uuid);
    CREATE FUNCTION capture_leave_history_report_user() RETURNS trigger
      LANGUAGE plpgsql AS $function$
      BEGIN
        INSERT INTO leave_history_report_user_probe
          VALUES(NEW.id,current_setting('app.user_id',true)::uuid);
        RETURN NEW;
      END;
    $function$;
    GRANT INSERT ON leave_history_report_user_probe TO pospay_app;
    CREATE TRIGGER capture_leave_history_report_user AFTER UPDATE OF status ON leave_history_reports
      FOR EACH ROW WHEN (NEW.status='ready') EXECUTE FUNCTION capture_leave_history_report_user();
  `);
  const id = await f.pendingReport();
  await build(id);
  expect(
    await f.owner`SELECT actor_id FROM leave_history_report_user_probe WHERE report_id=${id}`,
  ).toEqual([{ actor_id: f.createdBy }]);
  await f.owner.unsafe('DROP TRIGGER capture_leave_history_report_user ON leave_history_reports');
});

it('two concurrent builds commit one result and one set of rows', async () => {
  const id = await f.pendingReport();
  await Promise.all([build(id), build(id)]);
  const [report] = await f.report(id);
  expect(report).toMatchObject({ status: 'ready' });
  expect(await f.rows(id)).toHaveLength(Number(report?.['row_count']));
});
