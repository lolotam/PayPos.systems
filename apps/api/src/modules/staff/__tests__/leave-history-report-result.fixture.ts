import {
  LEAVE_HISTORY_REPORT_RETENTION_MS,
  leaveHistoryItem,
  leaveHistoryReportStoredScope,
} from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { LEAVE_HISTORY_REPORT_DEADLINE_MS } from '../domain/leave-history-report-request.ts';
import { createLeaveReadAccess } from '../persistence/leave-read-access.adapter.ts';
import { leaveFixture, leaveIds, type LeaveFixture } from './leave.fixture.ts';

export { leaveFixture, leaveIds };
export type { LeaveFixture };

const MINUTE_MS = 60_000;

// The frozen scope of a real report is the live access scope at request time. Seeding it from the
// live access keeps the status read from answering STALE for a report nobody changed.
export async function liveStoredScope(f: LeaveFixture) {
  const access = createLeaveReadAccess({ now: () => new Date() });
  const scope = await f.db.withTenant(f.company, (tx) =>
    access.check(tx, {
      companyId: f.company,
      userId: f.userId,
      businessId: f.business,
      own: false,
    }),
  );
  if (scope === null) throw new Error('LEAVE_HISTORY_REPORT_SCOPE_MISSING');
  return leaveHistoryReportStoredScope.parse({
    branches: [...scope.branches].sort(),
    attendanceBranches: [...scope.attendanceBranches].sort(),
    cancelBranches: [...scope.cancelBranches].sort(),
    decideBranches: [...scope.decideBranches].sort(),
    revokeBranches: [...scope.revokeBranches].sort(),
    createBranches: [...scope.createBranches].sort(),
    eligibilityBranchIds: [...new Set(scope.eligibilityDays.map((day) => day.branchId))].sort(),
  });
}

// The report deadlines are relative to as_of exactly like the worker writes them, so a seeded row
// satisfies the deadline_at and expires_at CHECK constraints without editing them afterwards.
function reportTimestamps(asOf: string) {
  const asOfMs = Date.parse(asOf);
  return {
    asOf,
    deadlineAt: new Date(asOfMs + LEAVE_HISTORY_REPORT_DEADLINE_MS).toISOString(),
    expiresAt: new Date(asOfMs + LEAVE_HISTORY_REPORT_RETENTION_MS).toISOString(),
  };
}

type SeedDirectReportOptions = {
  id?: string;
  userId?: string;
  businessId?: string;
  companyId?: string;
  status?: 'pending' | 'ready' | 'failed';
  rowCount?: number;
  errorCode?: 'LEAVE_HISTORY_REPORT_FAILED' | 'LEAVE_HISTORY_REPORT_TOO_LARGE' | null;
  asOf?: string;
  deadlineAt?: string;
  expiresAt?: string;
  scope?: object;
  query?: object;
  rows?: Array<{ employeeId: string; record?: object }>;
};

// The rows are inserted one by one, so a seeded report carries the records the worker writes.
async function insertReportRows(
  f: LeaveFixture,
  company: string,
  reportId: string,
  rows: Array<{ employeeId: string; record?: object }>,
) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row === undefined) throw new Error('LEAVE_HISTORY_REPORT_ROW_MISSING');
    const seq = i + 1;
    const record = leaveHistoryItem.parse(
      row.record ?? {
        row_type: 'UNEXCUSED_ABSENCE',
        id: leaveIds.newId(),
        employee_id: row.employeeId,
        employee_name_en: 'Synthetic employee',
        employee_name_ar: null,
        employee_number: 1,
        working_date: '2026-10-01',
        branch_id: f.branch,
        shifts: [{ start: '09:00', end: '17:00' }],
        status: 'ABSENT',
      },
    );
    await f.h.owner`INSERT INTO leave_history_report_rows
      (company_id, report_id, seq, employee_id, record)
      VALUES (${company}, ${reportId}, ${seq}, ${row.employeeId}, ${JSON.stringify(record)}::jsonb)`;
  }
}

// The status moves through the same UPDATE the worker uses, so the trigger sees the same transition.
async function applyReportStatus(
  f: LeaveFixture,
  company: string,
  reportId: string,
  options: Pick<SeedDirectReportOptions, 'status' | 'rowCount' | 'errorCode' | 'rows'>,
) {
  if (options.status === 'ready') {
    const rowCount = options.rowCount ?? (options.rows?.length ?? 0);
    await f.h.owner`UPDATE leave_history_reports
      SET status = 'ready', computed_at = now(), row_count = ${rowCount}
      WHERE company_id = ${company} AND id = ${reportId}`;
  } else if (options.status === 'failed') {
    const code = options.errorCode ?? 'LEAVE_HISTORY_REPORT_FAILED';
    await f.h.owner`UPDATE leave_history_reports
      SET status = 'failed', error_code = ${code}
      WHERE company_id = ${company} AND id = ${reportId}`;
  }
}

export async function seedDirectReport(f: LeaveFixture, options: SeedDirectReportOptions = {}) {
  const reportId = options.id ?? leaveIds.newId();
  const company = options.companyId ?? f.company;
  const business = options.businessId ?? f.business;
  const user = options.userId ?? f.userId;
  const timing = reportTimestamps(options.asOf ?? new Date(Date.now() - MINUTE_MS).toISOString());
  const asOf = timing.asOf;
  const deadlineAt = options.deadlineAt ?? timing.deadlineAt;
  const expiresAt = options.expiresAt ?? timing.expiresAt;
  const scope = options.scope ?? (await liveStoredScope(f));
  const query = options.query ?? {
    from: '2026-01-01',
    to: '2026-10-31',
    'types[]': ['ANNUAL'],
    'statuses[]': ['APPROVED'],
  };
  const fingerprint = '0'.repeat(64);

  // 1. Initial insert as pending with 0 rows (enforced by DB trigger)
  await f.h.owner`INSERT INTO leave_history_reports
    (company_id, id, business_id, created_by, query, fingerprint, scope, as_of, deadline_at, status, row_count, expires_at)
    VALUES (${company}, ${reportId}, ${business}, ${user}, ${JSON.stringify(query)}::jsonb,
    ${fingerprint}, ${JSON.stringify(scope)}::jsonb, ${asOf}::timestamptz, ${deadlineAt}::timestamptz,
    'pending', 0, ${expiresAt}::timestamptz)`;

  // 2. Insert rows if provided
  if (options.rows && options.rows.length > 0) {
    await insertReportRows(f, company, reportId, options.rows);
  }

  // 3. Move status to ready or failed via UPDATE
  await applyReportStatus(f, company, reportId, options);

  return reportId;
}

export async function seed2500RowReport(f: LeaveFixture, employeeId: string) {
  const reportId = leaveIds.newId();
  const scope = await liveStoredScope(f);
  const query = {
    from: '2026-01-01',
    to: '2026-10-31',
    'types[]': ['ANNUAL'],
    'statuses[]': ['APPROVED'],
  };

  await f.h.owner`INSERT INTO leave_history_reports
    (company_id, id, business_id, created_by, query, fingerprint, scope, as_of, deadline_at, status, row_count, expires_at)
    VALUES (${f.company}, ${reportId}, ${f.business}, ${f.userId}, ${JSON.stringify(query)}::jsonb,
    ${'1'.repeat(64)}, ${JSON.stringify(scope)}::jsonb, now(), now() + interval '10 minutes',
    'pending', 0, now() + interval '1 hour')`;

  await f.h.owner`INSERT INTO leave_history_report_rows (company_id, report_id, seq, employee_id, record)
    SELECT
      ${f.company},
      ${reportId},
      s,
      ${employeeId}::uuid,
      jsonb_build_object(
        'row_type', 'UNEXCUSED_ABSENCE',
        'id', gen_random_uuid(),
        'employee_id', ${employeeId}::uuid,
        'employee_name_en', 'Synthetic employee',
        'employee_name_ar', null,
        'employee_number', s,
        'working_date', '2026-10-01',
        'branch_id', ${f.branch}::uuid,
        'shifts', jsonb_build_array(jsonb_build_object('start', '09:00', 'end', '17:00')),
        'status', 'ABSENT'
      )
    FROM generate_series(1, 2500) AS s`;

  // The stored record must be a valid leaveHistoryItem; the contract proves it instead of guessing.
  const [stored] = await f.h.owner`SELECT record FROM leave_history_report_rows
    WHERE company_id = ${f.company} AND report_id = ${reportId} AND seq = 1`;
  leaveHistoryItem.parse(stored?.['record']);

  await f.h.owner`UPDATE leave_history_reports
    SET status = 'ready', computed_at = now(), row_count = 2500
    WHERE company_id = ${f.company} AND id = ${reportId}`;

  return reportId;
}

export function getReportResultHttp(
  f: LeaveFixture,
  reportId: string,
  suffix = '',
  options: { cookie?: string; company?: string; business?: string } = {},
) {
  return f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${options.business ?? f.business}/leave-history/reports/${reportId}${suffix}`,
    headers: {
      cookie: options.cookie ?? f.cookie,
      'x-company-id': options.company ?? f.company,
    },
  });
}

export async function setupSecondResultUser(f: LeaveFixture) {
  const cookie = await f.h.signedInOperator('other-reader@example.test');
  const [user] = await f.h
    .owner`SELECT id FROM "user" WHERE email='other-reader@example.test'`;
  const userId = user?.['id'] as string;
  const role = SYSTEM_ROLES.find((r) => r.code === 'business_manager');
  const memberId = leaveIds.newId();
  await f.h.owner`INSERT INTO memberships
    (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, starts_at)
    VALUES (${f.company}, ${memberId}, ${userId}, ${role?.id as string}, 'global', 'BUSINESS', ${f.business}, '2026-01-01T00:00:00Z')`;
  return { userId, cookie, memberId };
}
