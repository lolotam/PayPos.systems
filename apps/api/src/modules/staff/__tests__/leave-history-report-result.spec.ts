import { afterAll, beforeAll, expect, it } from 'vitest';
import { encodeCursor } from '../../../shared/persistence/name-options-cursor.ts';
import { SYSTEM_ROLES } from '@pospay/db';
import { createLeaveReadAccess } from '../persistence/leave-read-access.adapter.ts';
import { LeaveHistoryReportResultReader } from '../queries/leave-history-report-result.query.ts';
import {
  getReportResultHttp,
  leaveFixture,
  leaveIds,
  seed2500RowReport,
  seedDirectReport,
  setupSecondResultUser,
  type LeaveFixture,
} from './leave-history-report-result.fixture.ts';

let f: LeaveFixture;

beforeAll(async () => {
  f = await leaveFixture();
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('returns status pending when report is pending and clock is before deadline', async () => {
  const reportId = await seedDirectReport(f, { status: 'pending' });
  const res = await getReportResultHttp(f, reportId);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: 'pending' });
});

it('returns status failed with error message when stored status is failed', async () => {
  const failedId = await seedDirectReport(f, {
    status: 'failed',
    errorCode: 'LEAVE_HISTORY_REPORT_FAILED',
  });
  const resFailed = await getReportResultHttp(f, failedId);
  expect(resFailed.statusCode).toBe(200);
  expect(resFailed.json()).toMatchObject({
    status: 'failed',
    error: {
      code: 'LEAVE_HISTORY_REPORT_FAILED',
      message_ar: expect.any(String),
      message_en: expect.any(String),
    },
  });

  const tooLargeId = await seedDirectReport(f, {
    status: 'failed',
    errorCode: 'LEAVE_HISTORY_REPORT_TOO_LARGE',
  });
  const resTooLarge = await getReportResultHttp(f, tooLargeId);
  expect(resTooLarge.statusCode).toBe(200);
  expect(resTooLarge.json()).toMatchObject({
    status: 'failed',
    error: {
      code: 'LEAVE_HISTORY_REPORT_TOO_LARGE',
      message_ar: expect.any(String),
      message_en: expect.any(String),
    },
  });
});

it('handles pending report past deadline: failed when unlocked, pending when locked FOR UPDATE', async () => {
  const unlockedId = await seedDirectReport(f, {
    status: 'pending',
    asOf: new Date(Date.now() - 1_200_000).toISOString(),
    deadlineAt: new Date(Date.now() - 600_000).toISOString(),
  });
  const resUnlocked = await getReportResultHttp(f, unlockedId);
  expect(resUnlocked.statusCode).toBe(200);
  expect(resUnlocked.json()).toMatchObject({
    status: 'failed',
    error: { code: 'LEAVE_HISTORY_REPORT_FAILED' },
  });

  const lockedId = await seedDirectReport(f, {
    status: 'pending',
    asOf: new Date(Date.now() - 1_200_000).toISOString(),
    deadlineAt: new Date(Date.now() - 600_000).toISOString(),
  });
  await f.h.owner.begin(async (lockedTx) => {
    await lockedTx`SELECT id FROM leave_history_reports WHERE company_id = ${f.company} AND id = ${lockedId} FOR UPDATE`;
    const resLocked = await getReportResultHttp(f, lockedId);
    expect(resLocked.statusCode).toBe(200);
    expect(resLocked.json()).toEqual({ status: 'pending' });
  });
});

it('pages through ready 2,500-row report with correct seq ordering and null next_cursor at end', async () => {
  const reportId = await seed2500RowReport(f, f.employee.id);

  const resPage1 = await getReportResultHttp(f, reportId, '?limit=100');
  expect(resPage1.statusCode, resPage1.body).toBe(200);
  const page1 = resPage1.json();
  expect(page1.status).toBe('ready');
  expect(page1.items).toHaveLength(100);
  expect(page1.last_taken).toBeNull();
  expect(page1.items[0].employee_number).toBe(1);
  expect(page1.items[99].employee_number).toBe(100);
  expect(page1.next_cursor).not.toBeNull();

  const resPage2 = await getReportResultHttp(f, reportId, `?limit=100&cursor=${page1.next_cursor}`);
  expect(resPage2.statusCode, resPage2.body).toBe(200);
  const page2 = resPage2.json();
  expect(page2.items).toHaveLength(100);
  expect(page2.items[0].employee_number).toBe(101);
  expect(page2.items[99].employee_number).toBe(200);

  let currentCursor = page2.next_cursor;
  let totalRows = page1.items.length + page2.items.length;
  let iterations = 0;
  while (currentCursor !== null && iterations < 30) {
    iterations++;
    const res = await getReportResultHttp(f, reportId, `?limit=100&cursor=${currentCursor}`);
    expect(res.statusCode, res.body).toBe(200);
    const page = res.json();
    totalRows += page.items.length;
    currentCursor = page.next_cursor;
  }
  expect(totalRows).toBe(2500);
  expect(currentCursor).toBeNull();
});

it('returns 409 LEAVE_HISTORY_REPORT_STALE for missing read, attendance, or eligibility branches', async () => {
  const missingBranchScope = {
    branches: [f.branch, leaveIds.newId()],
    attendanceBranches: [f.branch],
    cancelBranches: [f.branch],
    decideBranches: [f.branch],
    revokeBranches: [f.branch],
    createBranches: [f.branch],
    eligibilityBranchIds: [f.branch],
  };
  const rep1 = await seedDirectReport(f, { status: 'ready', scope: missingBranchScope });
  const res1 = await getReportResultHttp(f, rep1);
  expect(res1.statusCode).toBe(409);
  expect(res1.json().code).toBe('LEAVE_HISTORY_REPORT_STALE');

  const missingAttendanceScope = {
    branches: [f.branch],
    attendanceBranches: [f.branch, leaveIds.newId()],
    cancelBranches: [f.branch],
    decideBranches: [f.branch],
    revokeBranches: [f.branch],
    createBranches: [f.branch],
    eligibilityBranchIds: [f.branch],
  };
  const rep2 = await seedDirectReport(f, { status: 'ready', scope: missingAttendanceScope });
  const res2 = await getReportResultHttp(f, rep2);
  expect(res2.statusCode).toBe(409);
  expect(res2.json().code).toBe('LEAVE_HISTORY_REPORT_STALE');

  const missingEligibilityScope = {
    branches: [f.branch],
    attendanceBranches: [f.branch],
    cancelBranches: [f.branch],
    decideBranches: [f.branch],
    revokeBranches: [f.branch],
    createBranches: [f.branch],
    eligibilityBranchIds: [f.branch, leaveIds.newId()],
  };
  const rep3 = await seedDirectReport(f, { status: 'ready', scope: missingEligibilityScope });
  const res3 = await getReportResultHttp(f, rep3);
  expect(res3.statusCode).toBe(409);
  expect(res3.json().code).toBe('LEAVE_HISTORY_REPORT_STALE');
});

it('returns 404 LEAVE_HISTORY_REPORT_NOT_FOUND for other creator, business, tenant, missing or expired report', async () => {
  const reportId = await seedDirectReport(f, { status: 'pending' });

  const second = await setupSecondResultUser(f);
  const resOtherCreator = await getReportResultHttp(f, reportId, '', { cookie: second.cookie });
  expect(resOtherCreator.statusCode).toBe(404);
  expect(resOtherCreator.json().code).toBe('LEAVE_HISTORY_REPORT_NOT_FOUND');

  const resOtherBusiness = await getReportResultHttp(f, reportId, '', { business: f.secondBusiness });
  expect(resOtherBusiness.statusCode).toBe(404);
  expect(resOtherBusiness.json().code).toBe('LEAVE_HISTORY_REPORT_NOT_FOUND');

  const resOtherTenant = await getReportResultHttp(f, reportId, '', { company: f.otherCompany });
  expect(resOtherTenant.statusCode).toBe(404);
  expect(resOtherTenant.json().code).toBe('LEAVE_HISTORY_REPORT_NOT_FOUND');

  const resUnknown = await getReportResultHttp(f, leaveIds.newId());
  expect(resUnknown.statusCode).toBe(404);
  expect(resUnknown.json().code).toBe('LEAVE_HISTORY_REPORT_NOT_FOUND');

  const expiredId = await seedDirectReport(f, {
    status: 'ready',
    asOf: new Date(Date.now() - 7_200_000).toISOString(),
    expiresAt: new Date(Date.now() - 3_600_000).toISOString(),
  });
  const resExpired = await getReportResultHttp(f, expiredId);
  expect(resExpired.statusCode).toBe(404);
  expect(resExpired.json().code).toBe('LEAVE_HISTORY_REPORT_NOT_FOUND');
});

it('skips soft-deleted employee live (PP-171) advancing window cursor across invisible rows', async () => {
  const reportId = await seed2500RowReport(f, f.employee.id);

  await f.h.owner`UPDATE employees SET deleted_at = now() WHERE id = ${f.employee.id}`;
  try {
    const res = await getReportResultHttp(f, reportId, '?limit=100');
    expect(res.statusCode, res.body).toBe(200);
    const page = res.json();
    expect(page.status).toBe('ready');
    expect(page.items).toEqual([]);
    expect(page.next_cursor).not.toBeNull();
  } finally {
    await f.h.owner`UPDATE employees SET deleted_at = NULL WHERE id = ${f.employee.id}`;
  }
});

it('refuses invalid cursor with 400 VALIDATION_FAILED on cursor path', async () => {
  const reportId = await seedDirectReport(f, { status: 'ready' });

  const otherReportCursor = encodeCursor({ report_id: leaveIds.newId(), seq: 10 });
  const resOther = await getReportResultHttp(f, reportId, `?cursor=${otherReportCursor}`);
  expect(resOther.statusCode).toBe(400);
  expect(resOther.json().code).toBe('VALIDATION_FAILED');
  expect(resOther.json().details).toContainEqual(expect.objectContaining({ path: ['cursor'] }));

  const resMalformed = await getReportResultHttp(f, reportId, '?cursor=invalid-not-base64');
  expect(resMalformed.statusCode).toBe(400);
  expect(resMalformed.json().code).toBe('VALIDATION_FAILED');
  expect(resMalformed.json().details).toContainEqual(expect.objectContaining({ path: ['cursor'] }));
});

it('refuses with 404 when access is null and 403 FEATURE_DISABLED when feature is off', async () => {
  const reportId = await seedDirectReport(f, { status: 'ready' });

  const cashier = SYSTEM_ROLES.find((r) => r.code === 'cashier');
  await f.h
    .owner`UPDATE memberships SET role_id=${cashier?.id as string} WHERE company_id=${f.company} AND id=${f.memberId}`;
  try {
    const resNoAccess = await getReportResultHttp(f, reportId);
    expect(resNoAccess.statusCode).toBe(404);
  } finally {
    const manager = SYSTEM_ROLES.find((r) => r.code === 'business_manager');
    await f.h
      .owner`UPDATE memberships SET role_id=${manager?.id as string} WHERE company_id=${f.company} AND id=${f.memberId}`;
  }

  await f.h.owner`INSERT INTO company_feature_overrides(company_id, flag, enabled, reason, set_by)
    VALUES (${f.company}, 'staff', false, 'test disable', ${f.userId})`;
  try {
    const resDisabled = await getReportResultHttp(f, reportId);
    expect(resDisabled.statusCode).toBe(403);
    expect(resDisabled.json().code).toBe('FEATURE_DISABLED');
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  }
});

// The HTTP path answers a reader failure as INTERNAL_ERROR, so the same report is read through the
// reader here: a broken page read shows the exception itself instead of an opaque 500.
it('reads a ready report page through the reader without throwing', async () => {
  const reportId = await seedDirectReport(f, {
    status: 'ready',
    rows: [{ employeeId: f.employee.id }, { employeeId: f.employee.id }],
  });
  const reader = new LeaveHistoryReportResultReader(
    f.db,
    createLeaveReadAccess({ now: () => new Date() }),
  );

  const result = await reader.execute(
    { companyId: f.company, userId: f.userId, businessId: f.business, own: false },
    reportId,
    { limit: 100 },
  );

  expect(result).toMatchObject({ status: 'ready' });
  expect(result).toHaveProperty('items', expect.arrayContaining([expect.anything()]));
});
