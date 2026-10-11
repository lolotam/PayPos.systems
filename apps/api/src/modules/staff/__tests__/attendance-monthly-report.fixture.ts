import { OWNER_ROLE_ID, SYSTEM_ROLES } from '@pospay/db';
import { salaryIds } from './salary.fixture.ts';
import { defaultHoursFixture, hoursCommand } from './employee-default-shifts.fixture.ts';

export async function monthlyReportFixture() {
  const f = await defaultHoursFixture();
  await f.setHours.execute(hoursCommand(f));
  await f.setHours.execute(hoursCommand(f,[{day:6,start:'14:00',end:'22:00'}],f.secondBranch));
  return f;
}
export type MonthlyReportFixture = Awaited<ReturnType<typeof monthlyReportFixture>>;
export const reportHeaders = (f: MonthlyReportFixture) => ({cookie:f.cookie,'x-company-id':f.company});
export const reportUrl = (f: MonthlyReportFixture, branch = f.branch, csv = false) =>
  `/v1/businesses/${f.business}${branch === 'all' ? '' : `/branches/${branch}`}/attendance-report${csv ? '.csv' : ''}?month=2026-10`;

export async function resetReportReader(f: MonthlyReportFixture) {
  await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company}
    AND membership_id=${f.memberId} AND permission_code='read:attendance:branch'`;
  await f.h.owner`UPDATE memberships SET role_id=${OWNER_ROLE_ID},role_owner_key='global',
    scope_type='COMPANY',scope_id=${f.company},ends_at=NULL WHERE company_id=${f.company} AND id=${f.memberId}`;
}
export async function scopeReportReader(f: MonthlyReportFixture, scopeType = 'BRANCH', scopeId = f.branch) {
  await reportRoleDefault(f,'branch_manager');
  await f.h.owner`UPDATE memberships SET
    scope_type=${scopeType},scope_id=${scopeId} WHERE company_id=${f.company} AND id=${f.memberId}`;
}
export async function denyReportBranch(f: MonthlyReportFixture, branch = f.secondBranch) {
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${salaryIds.newId()},${f.memberId},'read:attendance:branch','DENY','BRANCH',${branch},'Synthetic denial',${f.userId})`;
}

export async function reportSession(f: MonthlyReportFixture, patch: {
  branch?: string; date?: string; start?: string; end?: string | null;
  status?: string; source?: string; late?: number; scheduledEnd?: string | null;
  clockIn?: string; clockOut?: string;
} = {}) {
  const id = salaryIds.newId(), date = patch.date ?? '2026-10-03', status = patch.status ?? 'CLOSED';
  const source = patch.source ?? 'QR', request = source === 'MANUAL' ? salaryIds.newId() : null;
  const clockIn = patch.clockIn ?? `${date}T${patch.start ?? '06:00'}:00.000Z`;
  const clockOut = status === 'OPEN' ? null : patch.clockOut ?? `${date}T${patch.end ?? '14:00'}:00.000Z`;
  if (request) await f.h.owner`INSERT INTO attendance_change_requests(company_id,id,business_id,branch_id,employee_id,
    kind,clock_in,clock_out,working_date,timezone,reason,requested_by,requested_at)
    VALUES(${f.company},${request},${f.business},${patch.branch ?? f.branch},${f.employee.id},'ADD_SESSION',
      ${clockIn},${clockOut},${date},'Asia/Kuwait','Synthetic manual entry',${f.userId},now())`;
  await f.h.owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
    clock_in,clock_out,status,source,closed_by,geo,late_minutes,scheduled_end,change_request_id)
    VALUES(${f.company},${id},${f.business},${patch.branch ?? f.branch},${f.employee.id},${date},'Asia/Kuwait',
      ${clockIn},${clockOut},${status},${source},${status === 'OPEN' ? null : source === 'MANUAL' ? 'MANUAL' : status === 'MISSED_OUT' ? 'MISSED_OUT' : 'EMPLOYEE'},
      'NONE',${patch.late ?? 0},${patch.scheduledEnd ?? null},${request})`;
  if (request) await f.h.owner`UPDATE attendance_change_requests SET session_id=${id},status='APPROVED',
    decided_by=${f.userId},decided_at=now() WHERE company_id=${f.company} AND id=${request}`;
  return id;
}
export async function voidReportSession(f: MonthlyReportFixture, sessionId: string) {
  const request = salaryIds.newId();
  await f.h.owner`INSERT INTO attendance_change_requests(company_id,id,business_id,branch_id,employee_id,kind,status,
    session_id,session_revision,reason,requested_by,requested_at,decided_by,decided_at)
    VALUES(${f.company},${request},${f.business},${f.branch},${f.employee.id},'VOID_SESSION','APPROVED',${sessionId},0,
      'Synthetic void',${f.userId},now(),${f.userId},now())`;
  await f.h.owner`UPDATE attendance_sessions SET voided_at=now(),voided_by=${f.userId},void_request_id=${request}
    WHERE company_id=${f.company} AND id=${sessionId}`;
}
export async function reportLeave(f: MonthlyReportFixture, type = 'ANNUAL', kind = 'FULL_DAY', status = 'APPROVED', date = '2026-10-04') {
  const id = salaryIds.newId();
  const start = kind === 'FULL_DAY' ? null : '16:00', end = kind === 'FULL_DAY' ? null : '18:00';
  const fullStart = new Date(Date.parse(`${date}T00:00:00Z`)-3*3600000).toISOString();
  await f.h.owner`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,"from","to",start,"end",
    timezone,starts_at,ends_at,type,note,status,requested_by,requested_at,decided_by,decided_at)
    VALUES(${f.company},${id},${f.business},${f.branch},${f.employee.id},${kind},${date},${date},${start},${end},
      'Asia/Kuwait',${kind === 'FULL_DAY' ? fullStart : `${date}T13:00:00Z`},
      ${kind === 'FULL_DAY' ? `${date}T21:00:00Z` : `${date}T15:00:00Z`},${type},'Synthetic leave',
      ${status},${f.userId},now(),${status === 'APPROVED' ? f.userId : null},${status === 'APPROVED' ? '2026-09-30T10:00:00Z' : null})`;
  return id;
}
export async function reportRoleDefault(f: MonthlyReportFixture, code: string) {
  const role = SYSTEM_ROLES.find((entry) => entry.code === code);
  if (!role) throw new Error('MISSING_SYNTHETIC_ROLE');
  await f.h.owner`UPDATE memberships SET role_id=${role.id},role_owner_key='global'
    WHERE company_id=${f.company} AND id=${f.memberId}`;
}
