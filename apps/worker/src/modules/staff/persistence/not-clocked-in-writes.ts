import {
  appendAuditLog,
  appendOutboxEvents,
  type IdGenerator,
  type OutboxEvent,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';
import { inAppRecipientGroups, type NoticeParameter } from '../domain/not-clocked-in.ts';
import type { EmployeePush, NoticeWrite, SuppressedWrite } from '../ports/not-clocked-in.port.ts';

/** حدث التنبيه بلا حمولته: الحمولة بتتضاف مع كل مجموعة مستلمين. */
type NoticeEvent = Omit<OutboxEvent, 'payload'>;

/** سطر أوتبوكس: معرّفه والحدث اللي هيتكتب. */
type OutboxEntry = { id: string; event: OutboxEvent };

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
): OutboxEntry[] {
  const event: NoticeEvent = {
    aggregateType: 'employee',
    aggregateId: notice.shift.employeeId,
    eventType: 'ShiftNotClockedIn',
  };
  const managerEvents = managerEntries(ids, event, notice, facts, groups);
  const employeePush = notice.employeePush;
  if (employeePush === null) return managerEvents;
  return [...managerEvents, pushEntry(ids, event, facts, notice, employeePush)];
}

function managerEntries(
  ids: IdGenerator,
  event: NoticeEvent,
  notice: NoticeWrite,
  facts: ReturnType<typeof noticeFacts>,
  groups: readonly (readonly string[])[],
): OutboxEntry[] {
  if (groups.length === 0)
    return [
      {
        id: ids.newId(),
        event: {
          ...event,
          payload: { ...facts, employee_push_user_id: notice.employeePushUserId },
        },
      },
    ];
  // الهدف الثابت للموظفة بيسافر مرة واحدة على أول حدث من التنبيه بس؛ وإشعارها نفسه هو آخر حدث منفصل اللي pushEntry بيكتبه.
  return groups.map((group, index) => ({
    id: ids.newId(),
    event: {
      ...event,
      payload: {
        ...facts,
        employee_push_user_id: index === 0 ? notice.employeePushUserId : null,
        notification_recipients: recipientsFor(group, notice.parameters),
      },
    },
  }));
}

// إشعار الموظفة بنفسها بيسافر في طلب لوحده (BR-008)، فمجموعة المديرين ما بتكررشه؛
// والموعد هو نهاية الوردية، فالتأخير في الطابور ميبعتش إشعار بعد ما الوردية خلصت.
function pushEntry(
  ids: IdGenerator,
  event: NoticeEvent,
  facts: ReturnType<typeof noticeFacts>,
  notice: NoticeWrite,
  employeePush: EmployeePush,
): OutboxEntry {
  return {
    id: ids.newId(),
    event: {
      ...event,
      payload: {
        ...facts,
        employee_push_user_id: null,
        notification_recipients: [
          {
            channel: 'PUSH' as const,
            user_id: employeePush.userId,
            template_key: 'shift_not_clocked_in_self' as const,
            template_revision: 1 as const,
            safe_parameters: employeePush.parameters,
            send_deadline: notice.shift.endsAt.toISOString(),
          },
        ],
      },
    },
  };
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

export async function suppressNotClockedIn(
  tx: Tx,
  ids: IdGenerator,
  companyId: string,
  notice: SuppressedWrite,
): Promise<boolean> {
  const id = ids.newId();
  const inserted = await tx.execute<{ id: string }>(sql`
    INSERT INTO attendance_not_clocked_in_notices(
      company_id,id,business_id,branch_id,employee_id,shift_starts_at,shift_ends_at,alert_due_at,notified_at,recipient_count,suppressed_at)
    VALUES(${companyId},${id},${notice.shift.businessId},${notice.shift.branchId},${notice.shift.employeeId},
      ${notice.shift.startsAt.toISOString()},${notice.shift.endsAt.toISOString()},${notice.alertAt.toISOString()},
      ${notice.detectedAt.toISOString()},0,${notice.detectedAt.toISOString()})
    ON CONFLICT (company_id, employee_id, shift_starts_at) DO NOTHING RETURNING id`);
  return inserted.length === 1;
}
