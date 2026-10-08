import { appendAuditLog, appendOutboxEvent, type IdGenerator, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { NoticeWrite } from '../ports/not-clocked-in.port.ts';

export async function recordNotClockedIn(
  tx: Tx,
  ids: IdGenerator,
  companyId: string,
  notice: NoticeWrite,
): Promise<boolean> {
  const id = ids.newId();
  const inserted = await tx.execute<{ id: string }>(sql`
    INSERT INTO attendance_not_clocked_in_notices(
      company_id,id,business_id,branch_id,employee_id,shift_starts_at,shift_ends_at,alert_due_at,notified_at,recipient_count)
    VALUES(${companyId},${id},${notice.shift.businessId},${notice.shift.branchId},${notice.shift.employeeId},
      ${notice.shift.startsAt.toISOString()},${notice.shift.endsAt.toISOString()},${notice.alertAt.toISOString()},
      ${notice.detectedAt.toISOString()},${notice.recipients.length})
    ON CONFLICT (company_id, employee_id, shift_starts_at) DO NOTHING RETURNING id`);
  if (inserted.length !== 1) return false;
  const payload = noticePayload(id, notice);
  await appendAuditLog(tx, ids.newId(), {
    entity: 'attendance_notice',
    entityId: id,
    action: 'not_clocked_in.detected',
    after: payload,
  });
  await appendOutboxEvent(tx, ids.newId(), {
    aggregateType: 'employee',
    aggregateId: notice.shift.employeeId,
    eventType: 'ShiftNotClockedIn',
    payload,
  });
  return true;
}

function noticePayload(id: string, notice: NoticeWrite) {
  const recipients =
    notice.parameters === null || notice.recipients.length === 0
      ? undefined
      : notice.recipients.map((userId) => ({
          channel: 'IN_APP' as const,
          user_id: userId,
          locale: 'ar' as const,
          template_key: 'shift_not_clocked_in' as const,
          template_revision: 1 as const,
          safe_parameters: notice.parameters,
        }));
  return {
    notice_id: id,
    employee_id: notice.shift.employeeId,
    business_id: notice.shift.businessId,
    branch_id: notice.shift.branchId,
    shift_starts_at: notice.shift.startsAt.toISOString(),
    shift_ends_at: notice.shift.endsAt.toISOString(),
    alert_due_at: notice.alertAt.toISOString(),
    detected_at: notice.detectedAt.toISOString(),
    ...(recipients === undefined ? {} : { notification_recipients: recipients }),
  };
}
