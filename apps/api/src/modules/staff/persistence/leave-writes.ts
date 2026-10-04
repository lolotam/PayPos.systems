import { appendAuditLog, appendOutboxEvent, type Tx, type IdGenerator } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { leaveSnapshot } from '../domain/leave-policy.ts';
import { LeaveError, type LeaveRecord } from '../domain/leave-types.ts';
export async function saveLeave(
  tx: Tx,
  companyId: string,
  ids: IdGenerator,
  before: LeaveRecord | null,
  row: LeaveRecord,
) {
  if (before === null) {
    await tx.execute(sql`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,"from","to",start,"end",timezone,starts_at,ends_at,type,note,status,requested_by,requested_at,revision)
      VALUES(${companyId},${row.id},${row.business_id},${row.branch_id},${row.employee_id},${row.kind},${row.from},${row.to},${row.start},${row.end},${row.timezone},${row.starts_at},${row.ends_at},${row.type},${row.note},${row.status},${row.requested_by},${row.requested_at},${row.revision})`);
  } else {
    const updated =
      await tx.execute(sql`UPDATE leave_requests SET status=${row.status},cancelled_by=${row.cancelled_by},cancelled_at=${row.cancelled_at},revision=${row.revision}
      WHERE company_id=${companyId} AND id=${row.id} AND revision=${before.revision} AND status='PENDING' RETURNING id`);
    if (updated.length !== 1) throw new LeaveError('LEAVE_REVISION_CONFLICT');
  }
  const snapshot = leaveSnapshot(row);
  await appendAuditLog(tx, ids.newId(), {
    entity: 'leave_request',
    entityId: row.id,
    action: before === null ? 'leave.requested' : 'leave.cancelled',
    before: before === null ? null : leaveSnapshot(before),
    after: snapshot,
  });
  await appendOutboxEvent(tx, ids.newId(), {
    aggregateType: 'leave_request',
    aggregateId: row.id,
    eventType: before === null ? 'LeaveRequested' : 'LeaveCancelled',
    payload: snapshot,
  });
}
