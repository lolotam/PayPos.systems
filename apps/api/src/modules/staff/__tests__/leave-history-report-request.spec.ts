import { afterAll, beforeAll, expect, it } from 'vitest';
import { leaveHistoryReportAccepted } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { LeaveHistoryReportRequestError } from '../domain/leave-history-report-request.ts';
import {
  createReportRequestUseCase,
  defaultReportRequestPayload,
  leaveFixture,
  leaveIds,
  postReportRequestHttp,
  queryLeaveHistoryReports,
  queryOutboxForReport,
  setupSecondReportCreator,
  type LeaveFixture,
} from './leave-history-report-request.fixture.ts';

let f: LeaveFixture;
const testClock = { now: () => new Date('2026-11-07T10:00:00.000Z') };

beforeAll(async () => {
  f = await leaveFixture();
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('accepts 202 via HTTP and stores pending row and outbox event atomically', async () => {
  await f.h.owner`DELETE FROM leave_history_reports WHERE company_id = ${f.company}`;
  const response = await postReportRequestHttp(f);
  expect(response.statusCode).toBe(202);
  const { report_id } = leaveHistoryReportAccepted.parse(response.json());

  const reports = await queryLeaveHistoryReports(f);
  expect(reports).toHaveLength(1);
  const report = reports[0];
  if (report === undefined) throw new Error('LEAVE_HISTORY_REPORT_ROW_MISSING');
  expect(report['id']).toBe(report_id);
  expect(report['status']).toBe('pending');
  expect(report['row_count']).toBe(0);
  expect(report['error_code']).toBeNull();
  expect(report['computed_at']).toBeNull();
  expect(report['fingerprint']).toMatch(/^[0-9a-f]{64}$/);

  const asOfTime = new Date(report['as_of'] as string).getTime();
  const deadlineTime = new Date(report['deadline_at'] as string).getTime();
  const expiresTime = new Date(report['expires_at'] as string).getTime();
  expect(deadlineTime - asOfTime).toBe(600_000);
  expect(expiresTime - asOfTime).toBe(3_600_000);

  const scope = report['scope'] as Record<string, unknown[]>;
  for (const set of [
    'branches',
    'attendanceBranches',
    'cancelBranches',
    'decideBranches',
    'revokeBranches',
    'createBranches',
    'eligibilityBranchIds',
  ]) {
    expect(Array.isArray(scope[set])).toBe(true);
  }

  const outboxEvents = await queryOutboxForReport(f, report_id);
  expect(outboxEvents).toEqual([
    {
      event_type: 'LeaveHistoryReportRequested',
      aggregate_type: 'leave_history_report',
      aggregate_id: report_id,
      payload: { report_id },
    },
  ]);
});

it('reuses same report id for identical creator and query without new row or event', async () => {
  const [existing] = await queryLeaveHistoryReports(f);
  const initialId = existing?.['id'] as string;
  const initialReports = await queryLeaveHistoryReports(f);
  const initialOutbox = await queryOutboxForReport(f, initialId);

  const response = await postReportRequestHttp(f);
  expect(response.statusCode).toBe(202);
  expect(response.json()).toEqual({ report_id: initialId });

  const finalReports = await queryLeaveHistoryReports(f);
  const finalOutbox = await queryOutboxForReport(f, initialId);
  expect(finalReports.length).toBe(initialReports.length);
  expect(finalOutbox.length).toBe(initialOutbox.length);
});

it('creates distinct reports for different creator, filter, or changed scope', async () => {
  const second = await setupSecondReportCreator(f);
  const resSecondUser = await postReportRequestHttp(f, defaultReportRequestPayload, {
    cookie: second.cookie,
  });
  expect(resSecondUser.statusCode).toBe(202);
  const secondReportId = resSecondUser.json().report_id;

  const resNewFilter = await postReportRequestHttp(f, {
    ...defaultReportRequestPayload,
    to: '2026-09-30',
  });
  expect(resNewFilter.statusCode).toBe(202);
  const newFilterReportId = resNewFilter.json().report_id;
  expect(newFilterReportId).not.toBe(secondReportId);

  const customAccess = {
    check: async () => ({
      featureEnabled: true,
      branches: [f.branch],
      attendanceBranches: [f.branch],
      cancelBranches: [f.branch],
      decideBranches: [f.branch],
      revokeBranches: [f.branch],
      createBranches: [f.branch],
      eligibilityDays: [{ branchId: f.branch, employeeId: f.employee.id, workingDate: '2026-10-01' }],
    }),
  };
  const useCase = createReportRequestUseCase(f, { access: customAccess as never });
  const changedScopeReport = await useCase.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    ...defaultReportRequestPayload,
  });
  expect(changedScopeReport.report_id).not.toBe(newFilterReportId);
});

it('never reuses ready or failed reports', async () => {
  await f.h.owner`DELETE FROM leave_history_reports WHERE company_id = ${f.company}`;
  const useCase = createReportRequestUseCase(f, { clock: testClock });
  const command = {
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    ...defaultReportRequestPayload,
  };

  const initial = await useCase.execute(command);
  await f.h.owner`UPDATE leave_history_reports
    SET status = 'ready', computed_at = now(), row_count = 0
    WHERE company_id = ${f.company} AND id = ${initial.report_id}`;

  const afterReady = await useCase.execute(command);
  expect(afterReady.report_id).not.toBe(initial.report_id);

  await f.h.owner`UPDATE leave_history_reports
    SET status = 'failed', error_code = 'LEAVE_HISTORY_REPORT_FAILED'
    WHERE company_id = ${f.company} AND id = ${afterReady.report_id}`;

  const afterFailed = await useCase.execute(command);
  expect(afterFailed.report_id).not.toBe(afterReady.report_id);
});

it('refuses the 4th live pending report with 409 LEAVE_HISTORY_REPORT_BUSY', async () => {
  await f.h.owner`DELETE FROM leave_history_reports WHERE company_id = ${f.company}`;
  // The HTTP route runs on the real clock, so the three live pending reports are seeded against it.
  const liveClock = { now: () => new Date() };
  const useCase = createReportRequestUseCase(f, { clock: liveClock });
  const base = { companyId: f.company, userId: f.userId, businessId: f.business };

  await useCase.execute({ ...base, ...defaultReportRequestPayload, to: '2026-08-01' });
  await useCase.execute({ ...base, ...defaultReportRequestPayload, to: '2026-08-02' });
  await useCase.execute({ ...base, ...defaultReportRequestPayload, to: '2026-08-03' });

  await expect(
    useCase.execute({ ...base, ...defaultReportRequestPayload, to: '2026-08-04' }),
  ).rejects.toThrow(new LeaveHistoryReportRequestError('LEAVE_HISTORY_REPORT_BUSY'));

  const httpBusy = await postReportRequestHttp(f, {
    ...defaultReportRequestPayload,
    to: '2026-08-04',
  });
  expect(httpBusy.statusCode).toBe(409);
  expect(httpBusy.json().code).toBe('LEAVE_HISTORY_REPORT_BUSY');
});

it('neither reuses nor counts an expired pending report', async () => {
  await f.h.owner`DELETE FROM leave_history_reports WHERE company_id = ${f.company}`;
  // A pending report only reaches the past of its deadline through its own as_of: the trigger
  // refuses every UPDATE that is not a pending -> ready/failed transition.
  const expiredClock = { now: () => new Date('2026-11-07T09:00:00.000Z') };
  const expiredUseCase = createReportRequestUseCase(f, { clock: expiredClock });
  const useCase = createReportRequestUseCase(f, { clock: testClock });
  const base = { companyId: f.company, userId: f.userId, businessId: f.business };

  const rep1 = await expiredUseCase.execute({
    ...base,
    ...defaultReportRequestPayload,
    to: '2026-08-01',
  });
  await expiredUseCase.execute({ ...base, ...defaultReportRequestPayload, to: '2026-08-02' });
  await expiredUseCase.execute({ ...base, ...defaultReportRequestPayload, to: '2026-08-03' });

  // The three reports above expired at 09:10, before the clock of the requests below.
  const rep4 = await useCase.execute({ ...base, ...defaultReportRequestPayload, to: '2026-08-04' });
  expect(rep4.report_id).toBeDefined();

  const reReq1 = await useCase.execute({ ...base, ...defaultReportRequestPayload, to: '2026-08-01' });
  expect(reReq1.report_id).not.toBe(rep1.report_id);
});

it('pending report with deadline_at exactly equal to now is neither reused nor counted', async () => {
  await f.h.owner`DELETE FROM leave_history_reports WHERE company_id = ${f.company}`;
  // as_of 09:50 gives deadline_at 10:00, exactly the clock of the requests below.
  const boundaryClock = { now: () => new Date('2026-11-07T09:50:00.000Z') };
  const boundaryUseCase = createReportRequestUseCase(f, { clock: boundaryClock });
  const useCase = createReportRequestUseCase(f, { clock: testClock });
  const base = { companyId: f.company, userId: f.userId, businessId: f.business };

  const repExact = await boundaryUseCase.execute({
    ...base,
    ...defaultReportRequestPayload,
    to: '2026-08-10',
  });
  await boundaryUseCase.execute({ ...base, ...defaultReportRequestPayload, to: '2026-08-11' });
  await boundaryUseCase.execute({ ...base, ...defaultReportRequestPayload, to: '2026-08-12' });

  // It is not counted, so 4th request succeeds
  const repNew = await useCase.execute({ ...base, ...defaultReportRequestPayload, to: '2026-08-13' });
  expect(repNew.report_id).toBeDefined();

  // It is not reused
  const repAgain = await useCase.execute({ ...base, ...defaultReportRequestPayload, to: '2026-08-10' });
  expect(repAgain.report_id).not.toBe(repExact.report_id);
});

it('concurrent identical requests serialize to one row, concurrent different serialize to 3 rows and 1 busy', async () => {
  await f.h.owner`DELETE FROM leave_history_reports WHERE company_id = ${f.company}`;
  const useCase = createReportRequestUseCase(f, { clock: testClock });
  const base = { companyId: f.company, userId: f.userId, businessId: f.business };

  const identical = await Promise.all([
    useCase.execute({ ...base, ...defaultReportRequestPayload, to: '2026-07-01' }),
    useCase.execute({ ...base, ...defaultReportRequestPayload, to: '2026-07-01' }),
  ]);
  expect(identical[0]?.report_id).toBe(identical[1]?.report_id);
  const countIdentical = await f.h
    .owner`SELECT count(*)::int AS count FROM leave_history_reports WHERE company_id = ${f.company}`;
  expect(countIdentical[0]?.['count']).toBe(1);

  await f.h.owner`DELETE FROM leave_history_reports WHERE company_id = ${f.company}`;
  const diffResults = await Promise.allSettled([
    useCase.execute({ ...base, ...defaultReportRequestPayload, to: '2026-07-11' }),
    useCase.execute({ ...base, ...defaultReportRequestPayload, to: '2026-07-12' }),
    useCase.execute({ ...base, ...defaultReportRequestPayload, to: '2026-07-13' }),
    useCase.execute({ ...base, ...defaultReportRequestPayload, to: '2026-07-14' }),
  ]);
  const fulfilled = diffResults.filter((r) => r.status === 'fulfilled');
  const rejected = diffResults.filter((r) => r.status === 'rejected');
  expect(fulfilled).toHaveLength(3);
  expect(rejected).toHaveLength(1);
  expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
    code: 'LEAVE_HISTORY_REPORT_BUSY',
  });
});

it('refuses unauthorized, foreign-tenant, no-read-scope and out-of-scope branch_id with 404 and no row', async () => {
  await f.h.owner`DELETE FROM leave_history_reports WHERE company_id = ${f.company}`;

  const resForeign = await postReportRequestHttp(f, defaultReportRequestPayload, {
    company: f.otherCompany,
  });
  expect(resForeign.statusCode).toBe(404);

  const resBadBranch = await postReportRequestHttp(f, {
    ...defaultReportRequestPayload,
    branch_id: leaveIds.newId(),
  });
  expect(resBadBranch.statusCode).toBe(404);

  const cashier = SYSTEM_ROLES.find((r) => r.code === 'cashier');
  await f.h
    .owner`UPDATE memberships SET role_id=${cashier?.id as string} WHERE company_id=${f.company} AND id=${f.memberId}`;
  try {
    const resNoScope = await postReportRequestHttp(f);
    expect(resNoScope.statusCode).toBe(404);
  } finally {
    const manager = SYSTEM_ROLES.find((r) => r.code === 'business_manager');
    await f.h
      .owner`UPDATE memberships SET role_id=${manager?.id as string} WHERE company_id=${f.company} AND id=${f.memberId}`;
  }

  const reports = await queryLeaveHistoryReports(f);
  expect(reports).toHaveLength(0);
});

it('refuses with FEATURE_DISABLED and creates no row when staff feature is off', async () => {
  await f.h.owner`DELETE FROM leave_history_reports WHERE company_id = ${f.company}`;
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${f.company},'staff',false,'Test disable',${f.userId})`;
  try {
    const response = await postReportRequestHttp(f);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FEATURE_DISABLED');
    const reports = await queryLeaveHistoryReports(f);
    expect(reports).toHaveLength(0);
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  }
});
