import { appendAuditLog, appendOutboxEvent, type IdGenerator, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { LockedMissedOutSession } from '../ports/missed-out.port.ts';

export async function raiseSuspected(
  tx: Tx,
  ids: IdGenerator,
  companyId: string,
  session: LockedMissedOutSession,
  dueAt: Date,
  at: Date,
): Promise<boolean> {
  const id = ids.newId();
  const inserted = await tx.execute<{ id: string }>(sql`
    INSERT INTO attendance_exceptions(company_id,id,business_id,employee_id,branch_id,session_id,kind,raised_at)
    VALUES(${companyId},${id},${session.businessId},${session.employeeId},${session.branchId},${session.id},'SUSPECTED_MISSED_OUT',${at.toISOString()})
    ON CONFLICT (company_id, session_id) WHERE kind = 'SUSPECTED_MISSED_OUT' DO NOTHING RETURNING id`);
  if (inserted.length !== 1) return false;
  const payload = {
    exception_id: id,
    kind: 'SUSPECTED_MISSED_OUT',
    session_id: session.id,
    employee_id: session.employeeId,
    business_id: session.businessId,
    branch_id: session.branchId,
    clock_in: session.clockIn.toISOString(),
    due_at: dueAt.toISOString(),
    raised_at: at.toISOString(),
  };
  await appendAuditLog(tx, ids.newId(), {
    entity: 'attendance_exception',
    entityId: id,
    action: 'suspected_missed_out.raised',
    after: payload,
  });
  await appendOutboxEvent(tx, ids.newId(), {
    aggregateType: 'employee',
    aggregateId: session.employeeId,
    eventType: 'AttendanceExceptionRaised',
    payload,
  });
  return true;
}

export async function closeMissedOut(
  tx: Tx,
  ids: IdGenerator,
  companyId: string,
  session: LockedMissedOutSession,
  closeAt: Date,
  at: Date,
): Promise<boolean> {
  const closed = await tx.execute<{ id: string }>(sql`
    UPDATE attendance_sessions SET clock_out=${closeAt.toISOString()}, status='MISSED_OUT', closed_by='MISSED_OUT', revision=revision+1
    WHERE company_id=${companyId} AND id=${session.id} AND status='OPEN' RETURNING id`);
  if (closed.length !== 1) return false;
  await tx.execute(sql`
    UPDATE attendance_exceptions SET status='RESOLVED', resolution='MISSED_OUT', resolved_at=${at.toISOString()}, resolved_by=NULL
    WHERE company_id=${companyId} AND session_id=${session.id} AND kind='SUSPECTED_MISSED_OUT' AND status='OPEN'`);
  const payload = {
    session_id: session.id,
    employee_id: session.employeeId,
    business_id: session.businessId,
    branch_id: session.branchId,
    occurred_at: closeAt.toISOString(),
    recorded_at: at.toISOString(),
  };
  await appendAuditLog(tx, ids.newId(), {
    entity: 'attendance_session',
    entityId: session.id,
    action: 'missed_out',
    after: payload,
  });
  await appendOutboxEvent(tx, ids.newId(), {
    aggregateType: 'employee',
    aggregateId: session.employeeId,
    eventType: 'AttendanceMissedOut',
    payload,
  });
  return true;
}
