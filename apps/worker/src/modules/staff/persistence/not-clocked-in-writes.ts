import { appendAuditLog, appendOutboxEvents, type IdGenerator, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { inAppRecipientGroups, type NoticeParameter } from '../domain/not-clocked-in.ts';
import type { NoticeWrite } from '../ports/not-clocked-in.port.ts';

export async function recordNotClockedIn(
  tx: Tx,
  ids: IdGenerator,
  companyId: string,
  notice: NoticeWrite,
): Promise<boolean> {
  const id = ids.newId();
  const groups = inAppRecipientGroups(notice.recipients);
  const inserted = await tx.execute<{ id: string }>(sql`
    INSERT INTO attendance_not_clocked_in_notices(
      company_id,id,business_id,branch_id,employee_id,shift_starts_at,shift_ends_at,alert_due_at,notified_at,recipient_count)
    VALUES(${companyId},${id},${notice.shift.businessId},${notice.shift.branchId},${notice.shift.employeeId},
      ${notice.shift.startsAt.toISOString()},${notice.shift.endsAt.toISOString()},${notice.alertAt.toISOString()},
      ${notice.detectedAt.toISOString()},${groups.reduce((total, group) => total + group.length, 0)})
    ON CONFLICT (company_id, employee_id, shift_starts_at) DO NOTHING RETURNING id`);
  if (inserted.length !== 1) return false;
  const facts = noticeFacts(id, notice);
  await appendAuditLog(tx, ids.newId(), {
    entity: 'attendance_notice',
    entityId: id,
    action: 'not_clocked_in.detected',
    after: { ...facts, recipient_user_ids: groups.flat() },
  });
  await appendOutboxEvents(tx, outboxEntries(ids, notice, facts, groups));
  return true;
}

function outboxEntries(
  ids: IdGenerator,
  notice: NoticeWrite,
  facts: ReturnType<typeof noticeFacts>,
  groups: readonly (readonly string[])[],
) {
  const event = {
    aggregateType: 'employee',
    aggregateId: notice.shift.employeeId,
    eventType: 'ShiftNotClockedIn',
  };
  if (groups.length === 0) return [{ id: ids.newId(), event: { ...event, payload: facts } }];
  const parameters = notice.parameters;
  return groups.map((group) => ({
    id: ids.newId(),
    event: {
      ...event,
      payload: { ...facts, notification_recipients: recipientsFor(group, parameters) },
    },
  }));
}

function recipientsFor(userIds: readonly string[], parameters: readonly NoticeParameter[]) {
  return userIds.map((userId) => ({
    channel: 'IN_APP' as const,
    user_id: userId,
    locale: 'ar' as const,
    template_key: 'shift_not_clocked_in' as const,
    template_revision: 1 as const,
    safe_parameters: parameters,
  }));
}

function noticeFacts(id: string, notice: NoticeWrite) {
  return {
    notice_id: id,
    employee_id: notice.shift.employeeId,
    business_id: notice.shift.businessId,
    branch_id: notice.shift.branchId,
    shift_starts_at: notice.shift.startsAt.toISOString(),
    shift_ends_at: notice.shift.endsAt.toISOString(),
    alert_due_at: notice.alertAt.toISOString(),
    detected_at: notice.detectedAt.toISOString(),
  };
}
