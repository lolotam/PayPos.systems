import { appendAuditLog, appendOutboxEvents, type IdGenerator, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { distinctRecipients, teamAlertGroups } from '../domain/team-alert-groups.ts';
import type { BreakNoticeWrite, BreakSuppressedWrite } from '../ports/break-not-returned.port.ts';

export async function recordBreakNotReturned(
  tx: Tx,
  ids: IdGenerator,
  companyId: string,
  notice: BreakNoticeWrite,
): Promise<boolean> {
  const id = ids.newId();
  const recipientCount = distinctRecipients(notice.recipients).length;
  const { shift } = notice;
  const inserted = await tx.execute<{ id: string }>(sql`
    INSERT INTO attendance_break_not_returned_notices(
      company_id,id,business_id,branch_id,employee_id,shift_starts_at,shift_ends_at,break_ends_at,break_out_at,
      alert_due_at,notified_at,recipient_count)
    VALUES(${companyId},${id},${shift.businessId},${shift.branchId},${shift.employeeId},
      ${shift.startsAt.toISOString()},${shift.endsAt.toISOString()},${notice.breakEndsAt.toISOString()},
      ${notice.breakOutAt.toISOString()},${notice.alertAt.toISOString()},${notice.detectedAt.toISOString()},
      ${recipientCount})
    ON CONFLICT (company_id, employee_id, shift_starts_at) DO NOTHING RETURNING id`);
  if (inserted.length !== 1) return false;
  await writeBreakNotice(tx, ids, notice, id);
  return true;
}

/**
 * يكتب التدقيق وأحداث الإشعار لسطر دفتر واحد؛ مسار الإدراج ومسار التحويل بيستخدموه سوا.
 *
 * @param tx معاملة الشركة
 * @param ids مولّد المعرفات
 * @param notice حقائق الإشعار
 * @param noticeId معرف سطر الدفتر
 */
export async function writeBreakNotice(
  tx: Tx,
  ids: IdGenerator,
  notice: BreakNoticeWrite,
  noticeId: string,
): Promise<void> {
  const users = distinctRecipients(notice.recipients);
  const groups = breakGroups(notice);
  const facts = noticeFacts(noticeId, notice);
  await appendAuditLog(tx, ids.newId(), {
    entity: 'attendance_notice',
    entityId: noticeId,
    action: `${notice.kind}.detected`,
    after: { ...facts, recipient_user_ids: users },
  });
  await appendOutboxEvents(tx, outboxEntries(ids, notice, facts, groups));
}

function outboxEntries(
  ids: IdGenerator,
  notice: BreakNoticeWrite,
  facts: ReturnType<typeof noticeFacts>,
  groups: ReturnType<typeof breakGroups>,
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
      payload: { ...facts, notification_recipients: group },
    },
  }));
}

// مجموعات المستلمين: الجرس وحده افتراضيًا، والإيميل والواتساب لما القاعدة تفعّلهم ويكون للمستخدم وجهة صالحة (62b-1).
function breakGroups(notice: BreakNoticeWrite) {
  return teamAlertGroups(notice.recipients, notice.audience, notice.kind, (userId) => ({
    channel: 'IN_APP' as const,
    user_id: userId,
    locale: 'ar' as const,
    template_key: notice.kind,
    template_revision: 1 as const,
    safe_parameters: notice.parameters,
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
    notice_kind: notice.kind,
    ...(notice.returned === null ? {} : {
      returned_branch_id: notice.returned.branchId,
      returned_at: notice.returned.clockIn.toISOString(),
    }),
  };
}

export async function suppressBreakNotReturned(
  tx: Tx,
  ids: IdGenerator,
  companyId: string,
  notice: BreakSuppressedWrite,
): Promise<boolean> {
  const id = ids.newId();
  const { shift } = notice;
  const inserted = await tx.execute<{ id: string }>(sql`
    INSERT INTO attendance_break_not_returned_notices(
      company_id,id,business_id,branch_id,employee_id,shift_starts_at,shift_ends_at,break_ends_at,break_out_at,
      alert_due_at,notified_at,recipient_count,suppressed_at,suppressed_kind)
    VALUES(${companyId},${id},${shift.businessId},${shift.branchId},${shift.employeeId},
      ${shift.startsAt.toISOString()},${shift.endsAt.toISOString()},${notice.breakEndsAt.toISOString()},
      ${notice.breakOutAt.toISOString()},${notice.alertAt.toISOString()},${notice.detectedAt.toISOString()},
      0,${notice.detectedAt.toISOString()},${notice.kind})
    ON CONFLICT (company_id, employee_id, shift_starts_at) DO NOTHING RETURNING id`);
  return inserted.length === 1;
}
