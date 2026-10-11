import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { attendanceBranch } from '../../tenancy/index.ts';
import { AttendanceChangeError } from '../domain/attendance-change-request.ts';
import { attendanceWorkingDate } from '../domain/clock-attendance.ts';
import type { ManualSessionContext } from '../domain/manual-attendance-session.ts';
import type { AttendanceChangeKindScope } from '../ports/attendance-change-kinds.port.ts';
import { correctionNeighbours } from './attendance-correction-records.ts';

export async function manualSessionTarget(
  scope: Omit<AttendanceChangeKindScope, 'target' | 'request'>,
) {
  const tx = scope.transaction as Tx;
  if (!scope.input.branch_id) return null;
  const [employee] = await tx.execute<{ id: string }>(sql`SELECT id FROM employees
    WHERE company_id=${scope.companyId} AND business_id=${scope.businessId}
      AND id=${scope.input.employee_id} AND deleted_at IS NULL`);
  return employee
    ? { employee_id: employee.id, branch_id: scope.input.branch_id.toLowerCase() }
    : null;
}

export async function lockManualSessionContext(scope: AttendanceChangeKindScope): Promise<void> {
  const tx = scope.transaction as Tx;
  // الأقفال فقط هنا؛ الرفض في check وحده حتى يظل رفض الطلب ممكناً بعد إيقاف الفرع أو حذف الموظف.
  await attendanceBranch(tx, scope.companyId, scope.businessId, scope.target.branch_id);
  await tx.execute(sql`SELECT id FROM employees
    WHERE company_id=${scope.companyId} AND business_id=${scope.businessId}
      AND id=${scope.target.employee_id} AND deleted_at IS NULL FOR SHARE`);
  await tx.execute(sql`SELECT id FROM employee_branches WHERE company_id=${scope.companyId}
    AND employee_id=${scope.target.employee_id} ORDER BY id FOR SHARE`);
}

export async function manualSessionContext(
  scope: AttendanceChangeKindScope,
): Promise<ManualSessionContext> {
  const tx = scope.transaction as Tx;
  const branch = await attendanceBranch(
    tx,
    scope.companyId,
    scope.businessId,
    scope.target.branch_id,
  );
  if (!branch) throw new AttendanceChangeError('NOT_FOUND');
  const [employee] = await tx.execute<{ hire_date: string; contract_end: string | null }>(sql`
    SELECT hire_date,contract_end FROM employees WHERE company_id=${scope.companyId}
      AND business_id=${scope.businessId} AND id=${scope.target.employee_id} AND deleted_at IS NULL FOR SHARE`);
  if (!employee) throw new AttendanceChangeError('NOT_FOUND');
  const attachments = await tx.execute<{ branch_id: string; from: string; to: string | null }>(sql`
    SELECT branch_id,"from","to" FROM employee_branches WHERE company_id=${scope.companyId}
      AND employee_id=${scope.target.employee_id} ORDER BY id FOR SHARE`);
  const at = new Date(scope.input.clock_in ?? '');
  if (!Number.isFinite(at.getTime()))
    throw new AttendanceChangeError('ATTENDANCE_MANUAL_INVALID_TIMES');
  const date = attendanceWorkingDate(at, branch.timezone);
  const shifts = await manualScheduleCandidates(tx, scope, at, date);
  const neighbours = await correctionNeighbours(tx, scope.companyId, scope.target.employee_id, {
    id: scope.requestId,
    working_date: date,
  });
  const pending = await tx.execute<{ id: string; clock_in: string; clock_out: string }>(sql`
    SELECT id,to_char(clock_in AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS clock_in,
      to_char(clock_out AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS clock_out
    FROM attendance_change_requests WHERE company_id=${scope.companyId}
      AND employee_id=${scope.target.employee_id} AND kind='ADD_SESSION' AND status='PENDING'`);
  const [stored] = scope.request
    ? await tx.execute<{ working_date: string; timezone: string }>(sql`
    SELECT working_date::text,timezone FROM attendance_change_requests
    WHERE company_id=${scope.companyId} AND id=${scope.requestId}`)
    : [];
  return {
    now: scope.now,
    timezone: branch.timezone,
    employee: { ...employee, attachments: [...attachments] },
    shifts: shifts.map((s) => ({
      startsAt: new Date(s.starts_at),
      endsAt: new Date(s.ends_at),
      workingDate: s.working_date,
    })),
    neighbours,
    pending,
    selfRequestId: scope.requestId,
    stored: stored ?? null,
  };
}

function manualScheduleCandidates(
  tx: Tx,
  scope: AttendanceChangeKindScope,
  at: Date,
  date: string,
) {
  // نسخة مقصودة من قراءة المسح لأن محول المسح تملكه شريحة 16b-2 (بحث R5).
  return tx.execute<{ starts_at: Date; ends_at: Date; working_date: string }>(sql`
    SELECT ss.starts_at,ss.ends_at,ss.working_date FROM staff_schedule_shifts ss
    JOIN staff_schedules s ON s.company_id=ss.company_id AND s.id=ss.schedule_id
    WHERE ss.company_id=${scope.companyId} AND ss.employee_id=${scope.target.employee_id} AND s.branch_id=${scope.target.branch_id}
      AND (ss.working_date=${date}::date OR (ss.starts_at<=${at.toISOString()}::timestamptz AND ss.ends_at>${at.toISOString()}::timestamptz))
    ORDER BY ss.starts_at`);
}
