import { type LeaveHistoryReportRequest } from '@pospay/contracts';
import { SYSTEM_ROLES, type IdGenerator } from '@pospay/db';
import { createLeaveReadAccess } from '../persistence/leave-read-access.adapter.ts';
import { createLeaveHistoryReportRequestTransactions } from '../persistence/leave-history-report-request.transactions.ts';
import { RequestLeaveHistoryReportUseCase } from '../use-cases/request-leave-history-report/request-leave-history-report.usecase.ts';
import { leaveFixture, leaveIds, type LeaveFixture } from './leave.fixture.ts';

export { leaveFixture, leaveIds };
export type { LeaveFixture };

export const defaultReportRequestPayload: LeaveHistoryReportRequest = {
  from: '2026-01-01',
  to: '2026-10-31',
  'types[]': ['ANNUAL'],
  'statuses[]': ['APPROVED'],
};

export function createReportRequestUseCase(
  f: LeaveFixture,
  options: {
    clock?: { now(): Date };
    ids?: IdGenerator;
    access?: ReturnType<typeof createLeaveReadAccess>;
  } = {},
) {
  const clock = options.clock ?? { now: () => new Date('2026-11-07T10:00:00.000Z') };
  const ids = options.ids ?? leaveIds;
  const access = options.access ?? createLeaveReadAccess(clock);
  const transactions = createLeaveHistoryReportRequestTransactions(f.db, ids, access);
  return new RequestLeaveHistoryReportUseCase(transactions, ids, clock);
}

export function postReportRequestHttp(
  f: LeaveFixture,
  payload: object = defaultReportRequestPayload,
  options: { company?: string; cookie?: string; business?: string } = {},
) {
  return f.h.app.inject({
    method: 'POST',
    url: `/v1/businesses/${options.business ?? f.business}/leave-history/reports`,
    headers: {
      cookie: options.cookie ?? f.cookie,
      'x-company-id': options.company ?? f.company,
    },
    payload,
  });
}

export async function setupSecondReportCreator(f: LeaveFixture) {
  const cookie = await f.h.signedInOperator('second-report-creator@example.test');
  const [user] = await f.h
    .owner`SELECT id FROM "user" WHERE email='second-report-creator@example.test'`;
  const userId = user?.['id'] as string;
  const role = SYSTEM_ROLES.find((r) => r.code === 'business_manager');
  const memberId = leaveIds.newId();
  await f.h.owner`INSERT INTO memberships
    (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, starts_at)
    VALUES (${f.company}, ${memberId}, ${userId}, ${role?.id as string}, 'global', 'BUSINESS', ${f.business}, '2026-01-01T00:00:00Z')`;
  return { userId, cookie, memberId };
}

export async function queryLeaveHistoryReports(f: LeaveFixture, companyId = f.company) {
  return f.h.owner`SELECT id, business_id, created_by, query, fingerprint, scope, as_of,
    deadline_at, expires_at, status, row_count, error_code, computed_at
    FROM leave_history_reports WHERE company_id = ${companyId}`;
}

export async function queryOutboxForReport(f: LeaveFixture, reportId: string) {
  return f.h.owner`SELECT event_type, aggregate_type, aggregate_id, payload
    FROM outbox WHERE company_id = ${f.company} AND aggregate_id = ${reportId}`;
}
