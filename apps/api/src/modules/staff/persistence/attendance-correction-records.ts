import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import {
  AttendanceCorrectionError,
  type AttendanceCorrectionNeighbour,
  type AttendanceCorrectionSession,
} from '../domain/attendance-correction.ts';
import type { AttendanceCorrectionActor } from '../ports/attendance-correction-transactions.port.ts';

const stamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export async function peekCorrectionSession(
  tx: Tx,
  actor: AttendanceCorrectionActor,
): Promise<{ employee_id: string; branch_id: string }> {
  const [row] = await tx.execute<{ employee_id: string; branch_id: string }>(sql`
    SELECT employee_id, branch_id FROM attendance_sessions
    WHERE company_id=${actor.companyId} AND id=${actor.sessionId} AND business_id=${actor.businessId}`);
  if (!row) throw new AttendanceCorrectionError('NOT_FOUND');
  return row;
}

export async function lockCorrectionState(
  tx: Tx,
  companyId: string,
  employeeId: string,
): Promise<void> {
  const [row] = await tx.execute<{ id: string }>(sql`
    SELECT id FROM attendance_states WHERE company_id=${companyId} AND id=${employeeId} FOR UPDATE`);
  if (!row) throw new AttendanceCorrectionError('NOT_FOUND');
}

export async function lockedCorrectionSession(
  tx: Tx,
  actor: AttendanceCorrectionActor,
): Promise<AttendanceCorrectionSession> {
  const [row] = await tx.execute<AttendanceCorrectionSession & Record<string, unknown>>(sql`
    SELECT id, employee_id, branch_id, working_date::text AS working_date, timezone,
      ${sql.raw(stamp('clock_in'))} AS clock_in,
      ${sql.raw(stamp('clock_out'))} AS clock_out,
      source, status, closed_by, late_minutes, revision,
      ${sql.raw(stamp('scheduled_start'))} AS scheduled_start
    FROM attendance_sessions
    WHERE company_id=${actor.companyId} AND id=${actor.sessionId} AND business_id=${actor.businessId}
    FOR UPDATE`);
  if (!row) throw new AttendanceCorrectionError('NOT_FOUND');
  return row;
}

export async function lockedCorrectionEmployeeUser(
  tx: Tx,
  companyId: string,
  employeeId: string,
): Promise<string | null> {
  const [row] = await tx.execute<{ user_id: string | null }>(sql`
    SELECT user_id FROM employees WHERE company_id=${companyId} AND id=${employeeId} FOR UPDATE`);
  if (!row) throw new AttendanceCorrectionError('NOT_FOUND');
  return row.user_id;
}

export function correctionNeighboursStatement(
  companyId: string,
  employeeId: string,
  session: Pick<AttendanceCorrectionSession, 'id' | 'working_date'>,
) {
  // قفل الحالة يحمي القراءة؛ يومان يغطيان مدة ١٦ ساعة واختلاف توقيت الفروع.
  // المفتوحة القديمة قد تتداخل رغم خروج يومها من النافذة، ولها فهرس جزئي بصف واحد للموظف.
  return sql`
    SELECT id, status,
      ${sql.raw(stamp('clock_in'))} AS clock_in,
      ${sql.raw(stamp('clock_out'))} AS clock_out
    FROM attendance_sessions
    WHERE company_id=${companyId} AND employee_id=${employeeId} AND id<>${session.id}
      AND status<>'OPEN'
      AND working_date BETWEEN ${session.working_date}::date - 2 AND ${session.working_date}::date + 2
    UNION ALL
    SELECT id, status,
      ${sql.raw(stamp('clock_in'))} AS clock_in,
      ${sql.raw(stamp('clock_out'))} AS clock_out
    FROM attendance_sessions
    WHERE company_id=${companyId} AND employee_id=${employeeId} AND id<>${session.id}
      AND status='OPEN'`;
}

export async function correctionNeighbours(
  tx: Tx,
  companyId: string,
  employeeId: string,
  session: Pick<AttendanceCorrectionSession, 'id' | 'working_date'>,
): Promise<AttendanceCorrectionNeighbour[]> {
  return tx.execute<AttendanceCorrectionNeighbour & Record<string, unknown>>(
    correctionNeighboursStatement(companyId, employeeId, session),
  );
}
