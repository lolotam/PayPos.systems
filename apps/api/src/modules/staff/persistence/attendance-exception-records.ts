import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import {
  AttendanceExceptionError,
  type AttendanceExceptionRecord,
} from '../domain/attendance-exception.ts';
import type { AttendanceExceptionActor } from '../ports/attendance-exception-transactions.port.ts';

export async function peekAttendanceExceptionBranch(
  tx: Tx,
  actor: AttendanceExceptionActor,
): Promise<string> {
  const [row] = await tx.execute<{ branch_id: string }>(sql`
    SELECT branch_id FROM attendance_exceptions
    WHERE company_id=${actor.companyId} AND id=${actor.exceptionId} AND business_id=${actor.businessId}`);
  if (!row) throw new AttendanceExceptionError('NOT_FOUND');
  return row.branch_id;
}

export async function lockedAttendanceException(
  tx: Tx,
  actor: AttendanceExceptionActor,
): Promise<AttendanceExceptionRecord> {
  const [row] = await tx.execute<{
    [K in keyof AttendanceExceptionRecord]: AttendanceExceptionRecord[K];
  }>(sql`
    SELECT id, session_id, employee_id, branch_id, kind, status, resolution, resolved_by,
      to_char(resolved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS resolved_at,
      reason,
      to_char(raised_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS raised_at,
      revision
    FROM attendance_exceptions
    WHERE company_id=${actor.companyId} AND id=${actor.exceptionId} AND business_id=${actor.businessId}
    FOR UPDATE`);
  if (!row) throw new AttendanceExceptionError('NOT_FOUND');
  return row;
}

export async function lockedEmployeeUser(
  tx: Tx,
  companyId: string,
  employeeId: string,
): Promise<string | null> {
  // قفل الاستثناء سبق هذا القفل لأن معرّف الموظف يُعرف من الصف نفسه.
  const [row] = await tx.execute<{ user_id: string | null }>(sql`
    SELECT user_id FROM employees WHERE company_id=${companyId} AND id=${employeeId} FOR UPDATE`);
  if (!row) throw new AttendanceExceptionError('NOT_FOUND');
  return row.user_id;
}
