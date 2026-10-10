import type { AttendanceChangeRequest } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { AttendanceChangeError } from '../domain/attendance-change-request.ts';
import type { AttendanceChangeActor } from '../ports/attendance-change-transactions.port.ts';

export async function readChangeRequest(
  tx: Tx,
  actor: AttendanceChangeActor,
  lock = false,
): Promise<AttendanceChangeRequest> {
  const [row] = await tx.execute<{ record: AttendanceChangeRequest }>(sql`
    SELECT jsonb_build_object('id',r.id,'business_id',r.business_id,'branch_id',r.branch_id,
      'kind',r.kind,'status',r.status,'employee',jsonb_build_object('id',e.id,'name_ar',e.name_ar,'name_en',e.name_en),
      'requested',CASE WHEN r.kind='ADD_SESSION' THEN jsonb_build_object(
        'clock_in',to_char(r.clock_in AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'clock_out',to_char(r.clock_out AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'working_date',r.working_date::text,'timezone',r.timezone) ELSE NULL END,
      'session_id',r.session_id,'session_revision',r.session_revision,'reason',r.reason,
      'requested_by',r.requested_by,'requested_at',to_char(r.requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'decided_by',r.decided_by,'decided_at',to_char(r.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'decision_reason',r.decision_reason,'cancelled_by',r.cancelled_by,
      'cancelled_at',to_char(r.cancelled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'revision',r.revision,'can_decide',false,'can_cancel',r.status='PENDING' AND r.requested_by=${actor.userId}) AS record
    FROM attendance_change_requests r JOIN employees e ON e.company_id=r.company_id AND e.business_id=r.business_id AND e.id=r.employee_id
    WHERE r.company_id=${actor.companyId} AND r.business_id=${actor.businessId} AND r.id=${actor.requestId ?? null}::uuid
    ${lock ? sql`FOR UPDATE OF r` : sql``}`);
  if (!row) throw new AttendanceChangeError('NOT_FOUND');
  return row.record;
}
export async function lockChangeState(
  tx: Tx,
  companyId: string,
  employeeId: string,
): Promise<void> {
  const [row] = await tx.execute(
    sql`SELECT id FROM attendance_states WHERE company_id=${companyId} AND id=${employeeId} FOR UPDATE`,
  );
  if (!row) throw new AttendanceChangeError('NOT_FOUND');
}
export async function changeEmployee(tx: Tx, actor: AttendanceChangeActor, employeeId: string) {
  const [row] = await tx.execute<{
    id: string;
    user_id: string | null;
    name_ar: string | null;
    name_en: string;
  }>(sql`
    SELECT id,user_id,name_ar,name_en FROM employees WHERE company_id=${actor.companyId}
      AND business_id=${actor.businessId} AND id=${employeeId} FOR SHARE`);
  if (!row) throw new AttendanceChangeError('NOT_FOUND');
  return row;
}
