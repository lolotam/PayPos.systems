import { appendAuditLog, appendOutboxEvents, type IdGenerator, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { BreakNoticeParameter } from '../domain/break-not-returned.ts';
import { inAppRecipientGroups } from '../domain/not-clocked-in.ts';
import type { BreakNoticeWrite } from '../ports/break-not-returned.port.ts';

export async function recordBreakNotReturned(
  tx: Tx,
  ids: IdGenerator,
  companyId: string,
  notice: BreakNoticeWrite,
): Promise<boolean> {
  const id = ids.newId();
  const groups = inAppRecipientGroups(notice.recipients);
  const { shift } = notice;
  const inserted = await tx.execute<{ id: string }>(sql`
    INSERT INTO attendance_break_not_returned_notices(
      company_id,id,business_id,branch_id,employee_id,shift_starts_at,shift_ends_at,break_ends_at,break_out_at,
      alert_due_at,notified_at,recipient_count)
    VALUES(${companyId},${id},${shift.businessId},${shift.branchId},${shift.employeeId},
      ${shift.startsAt.toISOString()},${shift.endsAt.toISOString()},${notice.breakEndsAt.toISOString()},
      ${notice.breakOutAt.toISOString()},${notice.alertAt.toISOString()},${notice.detectedAt.toISOString()},
      ${groups.reduce((total, group) => total + group.length, 0)})
    ON CONFLICT (company_id, employee_id, shift_starts_at) DO NOTHING RETURNING id`);
  if (inserted.length !== 1) return false;
  const facts = noticeFacts(id, notice);
  await appendAuditLog(tx, ids.newId(), {
    entity: 'attendance_notice',
    entityId: id,
    action: 'break_not_returned.detected',
    after: { ...facts, recipient_user_ids: groups.flat() },
  });
  await appendOutboxEvents(tx, outboxEntries(ids, notice, facts, groups));
  return true;
}

function outboxEntries(
  ids: IdGenerator,
  notice: BreakNoticeWrite,
  facts: ReturnType<typeof noticeFacts>,
  groups: readonly (readonly string[])[],
) {
  const event = {
    aggregateType: 'employee',
    aggregateId: notice.shift.employeeId,
    eventType: 'ShiftBreakNotReturned',
  };
  if (groups.length === 0) return [{ id: ids.newId(), event: { ...event, payload: facts } }];
  return groups.map((group) => ({
    id: ids.newId(),
    event: {
      ...event,
      payload: { ...facts, notification_recipients: recipientsFor(group, notice.parameters) },
    },
  }));
}

function recipientsFor(userIds: readonly string[], parameters: readonly BreakNoticeParameter[]) {
  return userIds.map((userId) => ({
    channel: 'IN_APP' as const,
    user_id: userId,
    locale: 'ar' as const,
    template_key: 'break_not_returned' as const,
    template_revision: 1 as const,
    safe_parameters: parameters,
  }));
}

function noticeFacts(id: string, notice: BreakNoticeWrite) {
  return {
    notice_id: id,
    employee_id: notice.shift.employeeId,
    business_id: notice.shift.businessId,
    branch_id: notice.shift.branchId,
    shift_starts_at: notice.shift.startsAt.toISOString(),
    shift_ends_at: notice.shift.endsAt.toISOString(),
    break_ends_at: notice.breakEndsAt.toISOString(),
    break_out_at: notice.breakOutAt.toISOString(),
    alert_due_at: notice.alertAt.toISOString(),
    detected_at: notice.detectedAt.toISOString(),
  };
}
