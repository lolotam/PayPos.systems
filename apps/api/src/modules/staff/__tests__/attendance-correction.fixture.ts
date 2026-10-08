import { OWNER_ROLE_ID } from '@pospay/db';
import { createAttendanceCorrectionTransactions } from '../persistence/drizzle-attendance-correction-transactions.ts';
import { CorrectAttendanceUseCase } from '../use-cases/correct-attendance/correct-attendance.usecase.ts';
import {
  attendanceExceptionFixture,
  type AttendanceExceptionFixture,
} from './attendance-exception.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

export async function attendanceCorrectionFixture() {
  const f = await attendanceExceptionFixture();
  const transactions = createAttendanceCorrectionTransactions(f.db, leaveIds);
  return { ...f, correct: new CorrectAttendanceUseCase(transactions, f.clock) };
}
export type AttendanceCorrectionFixture = Awaited<ReturnType<typeof attendanceCorrectionFixture>> &
  AttendanceExceptionFixture;
export const correctionInput = (
  revision = 0,
  patch: { clock_in?: string; clock_out?: string; reason?: string } = {},
) => ({
  revision,
  reason: '  wrong scan time  ',
  clock_out: '2026-10-04T09:00:00.000Z',
  ...patch,
});
export const correctionActor = (
  f: AttendanceCorrectionFixture,
  sessionId: string,
  userId = f.approverId,
  key = leaveIds.newId(),
  fingerprint = key,
) => ({
  companyId: f.company,
  userId,
  businessId: f.business,
  sessionId,
  key,
  fingerprint,
});
export async function seedSession(
  f: AttendanceCorrectionFixture,
  patch: {
    employeeId?: string;
    branchId?: string;
    workingDate?: string;
    clockIn?: string;
    clockOut?: string | null;
    status?: 'OPEN' | 'CLOSED' | 'MISSED_OUT';
    closedBy?: 'EMPLOYEE' | 'MISSED_OUT' | null;
    late?: number;
    scheduledStart?: string | null;
    revision?: number;
    source?: 'QR' | 'BARCODE';
    geo?: 'OK' | 'NONE' | 'OUT_OF_RANGE';
    outGeo?: 'OK' | 'NONE' | 'OUT_OF_RANGE' | null;
    outOperatorId?: string | null;
  } = {},
) {
  const id = leaveIds.newId();
  const employeeId = patch.employeeId ?? (await linkEmployee(f, null));
  const status = patch.status ?? 'CLOSED';
  await f.h.owner`INSERT INTO attendance_sessions(
      company_id,id,business_id,branch_id,employee_id,working_date,timezone,clock_in,clock_out,status,source,closed_by,geo,out_geo,late_minutes,scheduled_start,revision,out_operator_id)
    VALUES(${f.company},${id},${f.business},${patch.branchId ?? f.branch},${employeeId},
      ${patch.workingDate ?? '2026-10-04'},'Asia/Kuwait',${patch.clockIn ?? '2026-10-04T05:00:00.000Z'},
      ${patch.clockOut === undefined ? '2026-10-04T08:00:00.000Z' : patch.clockOut},${status},${patch.source ?? 'QR'},
      ${patch.closedBy === undefined ? 'EMPLOYEE' : patch.closedBy},${patch.geo ?? 'NONE'},
      ${patch.outGeo === undefined ? 'NONE' : patch.outGeo},${patch.late ?? 40},
      ${patch.scheduledStart === undefined ? '2026-10-04T04:20:00.000Z' : patch.scheduledStart},${patch.revision ?? 0},
      ${patch.outOperatorId ?? null})`;
  return id;
}
export async function linkEmployee(f: AttendanceCorrectionFixture, userId: string | null) {
  const id = leaveIds.newId();
  await f.h
    .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,role_code,hire_date,user_id)
    VALUES(${f.company},${id},${f.business},${f.branch},'Synthetic corrected employee','staff','2026-01-01',${userId})`;
  return id;
}
export async function ownerUserId(f: AttendanceCorrectionFixture) {
  const [row] = await f.h.owner`SELECT id FROM "user" WHERE email='employee-owner@example.test'`;
  const userId = row?.['id'] as string;
  const [member] = await f.h.owner`SELECT id FROM memberships
    WHERE company_id=${f.company} AND user_id=${userId} AND role_id=${OWNER_ROLE_ID} AND scope_type='COMPANY'`;
  if (member === undefined) throw new Error('OWNER_MEMBERSHIP_MISSING');
  return userId;
}
export const correctionRows = (f: AttendanceCorrectionFixture, sessionId: string) =>
  f.h.owner`SELECT field, reason, corrected_by, request_id,
      to_char(before_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS before_at,
      to_char(after_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS after_at
    FROM attendance_corrections WHERE company_id=${f.company} AND session_id=${sessionId} ORDER BY id`;
export const correctionAudits = (f: AttendanceCorrectionFixture, sessionId: string) =>
  f.h.owner`SELECT action, before, after FROM audit_log
    WHERE company_id=${f.company} AND entity='attendance_session' AND entity_id=${sessionId}
      AND action='attendance_session.corrected' ORDER BY id`;
export const sessionRow = (f: AttendanceCorrectionFixture, sessionId: string) =>
  f.h.owner`SELECT status, closed_by, late_minutes, revision, source, geo, out_geo, out_operator_id,
      to_char(clock_in AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS clock_in,
      to_char(clock_out AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS clock_out
    FROM attendance_sessions WHERE company_id=${f.company} AND id=${sessionId}`;
