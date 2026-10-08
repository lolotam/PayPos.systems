import { SYSTEM_ROLES } from '@pospay/db';
import { leaveDecisionFixture, type LeaveDecisionFixture } from './leave-decision.fixture.ts';
import { leaveIds } from './leave.fixture.ts';
import { createAttendanceExceptionTransactions } from '../persistence/drizzle-attendance-exception-transactions.ts';
import { ReopenAttendanceExceptionUseCase } from '../use-cases/reopen-attendance-exception/reopen-attendance-exception.usecase.ts';
import { ResolveAttendanceExceptionUseCase } from '../use-cases/resolve-attendance-exception/resolve-attendance-exception.usecase.ts';

export async function attendanceExceptionFixture() {
  const f = await leaveDecisionFixture();
  const tx = createAttendanceExceptionTransactions(f.db, leaveIds);
  return {
    ...f,
    resolve: new ResolveAttendanceExceptionUseCase(tx, f.clock),
    reopen: new ReopenAttendanceExceptionUseCase(tx, f.clock),
  };
}
export type AttendanceExceptionFixture = Awaited<ReturnType<typeof attendanceExceptionFixture>> &
  LeaveDecisionFixture;
export const decision = (revision = 0, reason = '  errand for the shop  ') => ({ revision, reason });
export const exceptionActor = (
  f: AttendanceExceptionFixture,
  exceptionId: string,
  userId = f.approverId,
  key = leaveIds.newId(),
  fingerprint = key,
) => ({
  companyId: f.company,
  userId,
  businessId: f.business,
  exceptionId,
  key,
  fingerprint,
});
export async function asRole(f: AttendanceExceptionFixture, code: string) {
  const role = SYSTEM_ROLES.find((entry) => entry.code === code);
  const scope =
    code === 'branch_manager' ? 'BRANCH' : code === 'business_manager' ? 'BUSINESS' : 'COMPANY';
  const scopeId = scope === 'BRANCH' ? f.branch : scope === 'BUSINESS' ? f.business : f.company;
  await f.h
    .owner`UPDATE memberships SET role_id=${role?.id as string},scope_type=${scope},scope_id=${scopeId} WHERE id=${f.approverMember}`;
}
export async function openException(
  f: AttendanceExceptionFixture,
  kind: 'NONE' | 'OUT_OF_RANGE' | 'SUSPECTED_MISSED_OUT',
  branchId = f.branch,
) {
  const sessionId = leaveIds.newId();
  const id = leaveIds.newId();
  await f.h
    .owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,clock_in,clock_out,status,source,closed_by,geo,out_geo,late_minutes)
    VALUES(${f.company},${sessionId},${f.business},${branchId},${f.employee.id},'2026-10-04','Asia/Kuwait','2026-10-04T08:00:00Z','2026-10-04T09:00:00Z','CLOSED','QR','EMPLOYEE','NONE','NONE',7)`;
  await f.h
    .owner`INSERT INTO attendance_exceptions(company_id,id,business_id,employee_id,branch_id,session_id,kind,raised_at)
    VALUES(${f.company},${id},${f.business},${f.employee.id},${branchId},${sessionId},${kind},'2026-10-04T08:00:00Z')`;
  return { id, sessionId };
}
export const exceptionAudits = (f: AttendanceExceptionFixture, id: string) =>
  f.h
    .owner`SELECT action,before,after FROM audit_log WHERE company_id=${f.company} AND entity='attendance_exception' AND entity_id=${id} ORDER BY id`;
export const sessionFact = (f: AttendanceExceptionFixture, sessionId: string) =>
  f.h
    .owner`SELECT status,clock_in,clock_out,late_minutes,geo,out_geo FROM attendance_sessions WHERE company_id=${f.company} AND id=${sessionId}`;
export const exceptionFact = (f: AttendanceExceptionFixture, id: string) =>
  f.h
    .owner`SELECT status,resolution,resolved_by,reason,revision,to_char(resolved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS resolved_at FROM attendance_exceptions WHERE company_id=${f.company} AND id=${id}`;
