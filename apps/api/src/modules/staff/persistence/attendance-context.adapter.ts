import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Tx } from '@pospay/db';
import { personalMemberships } from '../../identity/index.ts';
import { attendanceBranch } from '../../tenancy/index.ts';
import { personalMember } from '../domain/passkey-binding.ts';
import {
  AttendanceError,
  attendanceEligible,
  attendanceWorkingDate,
  type ClockResult,
} from '../domain/clock-attendance.ts';
import type { PasskeyScope } from '../ports/passkeys.port.ts';
import type { AttendanceScan, AttendanceContext } from '../ports/clock-attendance.port.ts';

export function scanDigest(scan: AttendanceScan): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        scan.token.branch_id,
        scan.token.window,
        scan.token.sig,
        scan.location === undefined
          ? null
          : [scan.location.lat, scan.location.lng, scan.location.accuracy],
      ]),
    )
    .digest('hex');
}
export async function lockAttendanceState(tx: Tx, scope: PasskeyScope) {
  const [state] = await tx.execute<{
    last_accepted_scan_at: Date | null;
    last_result: ClockResult | null;
  }>(sql`
    SELECT last_accepted_scan_at,last_result FROM attendance_states WHERE company_id=${scope.companyId} AND employee_id=${scope.employeeId} FOR UPDATE`);
  if (state === undefined) throw new AttendanceError('NOT_FOUND');
  return state;
}
export async function lockedAttendanceContext(
  tx: Tx,
  scope: PasskeyScope,
  scan: AttendanceScan,
  sample: () => Date,
  state: Awaited<ReturnType<typeof lockAttendanceState>>,
): Promise<{ context: AttendanceContext; at: Date }> {
  const memberships = await personalMemberships(tx, scope.companyId, scope.userId, true, null);
  if (memberships.length === 0) throw new AttendanceError('NOT_FOUND');
  const employee = await lockedEmployee(tx, scope);
  const [binding] = await tx.execute<{ id: string; revision: number; passkey_id: string }>(sql`
    SELECT id,revision,passkey_id FROM employee_passkeys WHERE company_id=${scope.companyId} AND business_id=${scope.businessId}
      AND employee_id=${scope.employeeId} AND unbound_at IS NULL FOR UPDATE`);
  if (binding === undefined) throw new AttendanceError('NOT_FOUND');
  const branch = await attendanceBranch(
    tx,
    scope.companyId,
    scope.businessId,
    scan.token.branch_id,
  );
  if (branch === null) throw new AttendanceError('NOT_FOUND');
  // وقت واحد بعد كل الأقفال؛ انتهاء العضوية أثناء الانتظار لا يتحول إلى صلاحية قديمة.
  const at = sample();
  const live = await personalMemberships(tx, scope.companyId, scope.userId, false, at);
  if (
    !personalMember(scope.companyId, scope.businessId, [scan.token.branch_id], live) ||
    !attendanceEligible(employee, scan.token.branch_id, attendanceWorkingDate(at, branch.timezone))
  )
    throw new AttendanceError('NOT_FOUND');
  const open = await openAttendance(tx, scope);
  const shifts = await scheduleCandidates(tx, scope, scan.token.branch_id, at, branch.timezone);
  const context: AttendanceContext = {
    bindingId: binding.id,
    bindingRevision: binding.revision,
    passkeyId: binding.passkey_id,
    timezone: branch.timezone,
    geo: branch.lat === null || branch.lng === null ? null : { lat: branch.lat, lng: branch.lng },
    qrContext: scanDigest(scan),
    location: scan.location,
    lastAt: state.last_accepted_scan_at === null ? null : new Date(state.last_accepted_scan_at),
    lastResult: state.last_result,
    open,
    shifts: shifts.map((s) => ({
      startsAt: new Date(s.starts_at),
      endsAt: new Date(s.ends_at),
      workingDate: s.working_date,
    })),
  };
  return { context, at };
}
async function lockedEmployee(tx: Tx, scope: PasskeyScope) {
  const [employee] = await tx.execute<{ hire_date: string; contract_end: string | null }>(sql`
    SELECT hire_date,contract_end FROM employees WHERE company_id=${scope.companyId} AND id=${scope.employeeId} AND business_id=${scope.businessId}
      AND user_id=${scope.userId} AND deleted_at IS NULL FOR UPDATE`);
  if (employee === undefined) throw new AttendanceError('NOT_FOUND');
  const attachments = await tx.execute<{ branch_id: string; from: string; to: string | null }>(sql`
    SELECT branch_id,"from","to" FROM employee_branches WHERE company_id=${scope.companyId} AND employee_id=${scope.employeeId} ORDER BY id FOR SHARE`);
  return { ...employee, attachments: Array.from(attachments) };
}
async function scheduleCandidates(
  tx: Tx,
  scope: PasskeyScope,
  branchId: string,
  at: Date,
  timezone: string,
) {
  const date = attendanceWorkingDate(at, timezone);
  return tx.execute<{ starts_at: Date; ends_at: Date; working_date: string }>(sql`
    SELECT ss.starts_at,ss.ends_at,ss.working_date FROM staff_schedule_shifts ss
    JOIN staff_schedules s ON s.company_id=ss.company_id AND s.id=ss.schedule_id
    WHERE ss.company_id=${scope.companyId} AND ss.employee_id=${scope.employeeId} AND s.branch_id=${branchId}
      AND (ss.working_date=${date}::date OR (ss.starts_at<=${at.toISOString()}::timestamptz AND ss.ends_at>${at.toISOString()}::timestamptz))
    ORDER BY ss.starts_at`);
}
async function openAttendance(tx: Tx, scope: PasskeyScope) {
  const [open] = await tx.execute<{
    id: string;
    clock_in: Date;
    working_date: string;
    late_minutes: number;
    branch_id: string;
  }>(sql`
    SELECT id,clock_in,working_date,late_minutes,branch_id FROM attendance_sessions WHERE company_id=${scope.companyId} AND employee_id=${scope.employeeId} AND status='OPEN'`);
  return open === undefined
    ? null
    : {
        id: open.id,
        clockIn: new Date(open.clock_in),
        workingDate: open.working_date,
        lateMinutes: open.late_minutes,
        branchId: open.branch_id,
      };
}
