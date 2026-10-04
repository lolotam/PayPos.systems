import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { LeaveError, type LeaveEmployee, type LeaveRecord } from '../domain/leave-types.ts';
import type { LeaveActor } from '../ports/leave-transactions.port.ts';
export async function lockedLeaveEmployee(tx: Tx, actor: LeaveActor): Promise<LeaveEmployee> {
  const [row] = await tx.execute<{ record: LeaveEmployee }>(sql`SELECT jsonb_build_object(
    'id',id,'user_id',user_id,'hire_date',hire_date,'contract_end',contract_end,'deleted_at',deleted_at,
    'attachments',COALESCE((SELECT jsonb_agg(jsonb_build_object('branch_id',branch_id,'from',"from",'to',"to")) FROM employee_branches eb
      WHERE eb.company_id=e.company_id AND eb.employee_id=e.id),'[]'::jsonb)) AS record
    FROM employees e WHERE company_id=${actor.companyId} AND business_id=${actor.businessId} AND deleted_at IS NULL
    AND ${actor.own ? sql`user_id=${actor.userId}` : sql`id=${actor.employeeId ?? null}::uuid`} FOR UPDATE`);
  if (!row) throw new LeaveError('NOT_FOUND');
  return row.record;
}
export async function lockedLeaveRecord(
  tx: Tx,
  actor: LeaveActor,
  employeeId: string,
): Promise<LeaveRecord | null> {
  if (!actor.leaveId) return null;
  const [row] = await tx.execute<{
    [K in keyof LeaveRecord]: LeaveRecord[K];
  }>(sql`SELECT id,business_id,branch_id,employee_id,kind,"from"::text,"to"::text,start,"end",timezone,
    to_char(starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS starts_at,
    to_char(ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ends_at,type,note,status,requested_by,
    to_char(requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS requested_at,cancelled_by,
    to_char(cancelled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS cancelled_at,decided_by,
    to_char(decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS decided_at,rejection_reason,revision
    FROM leave_requests WHERE company_id=${actor.companyId} AND business_id=${actor.businessId} AND employee_id=${employeeId} AND id=${actor.leaveId} FOR UPDATE`);
  if (!row) throw new LeaveError('NOT_FOUND');
  return row;
}
