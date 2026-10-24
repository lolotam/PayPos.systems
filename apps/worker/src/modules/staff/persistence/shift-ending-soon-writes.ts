import { appendAuditLog, appendOutboxEvents, type IdGenerator, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type {
  ShiftEndNoticeWrite,
  ShiftEndSuppressedWrite,
} from '../ports/shift-ending-soon.port.ts';

export async function recordShiftEndingSoon(
  tx: Tx,
  ids: IdGenerator,
  companyId: string,
  notice: ShiftEndNoticeWrite,
): Promise<boolean> {
  const id = ids.newId();
  const { shift } = notice;
  // الموظفة من غير حساب مرتبط (أو عضويتها انتهت) بتتقفل بسطر دفتر وحدث من غير مستلمين (SE-Q6).
  const recipientCount = notice.userId === null ? 0 : 1;
  const inserted = await tx.execute<{ id: string }>(sql`
    INSERT INTO attendance_shift_ending_notices(
      company_id,id,business_id,branch_id,employee_id,shift_starts_at,shift_ends_at,remind_due_at,notified_at,recipient_count)
    VALUES(${companyId},${id},${shift.businessId},${shift.branchId},${shift.employeeId},
      ${shift.startsAt.toISOString()},${shift.endsAt.toISOString()},${notice.remindAt.toISOString()},
      ${notice.detectedAt.toISOString()},${recipientCount})
    ON CONFLICT (company_id, employee_id, shift_ends_at) DO NOTHING RETURNING id`);
  if (inserted.length !== 1) return false;
  const facts = noticeFacts(id, notice);
  await appendAuditLog(tx, ids.newId(), {
    entity: 'attendance_notice',
    entityId: id,
    action: 'shift_ending_soon.detected',
    after: facts,
  });
  await appendOutboxEvents(tx, [
    {
      id: ids.newId(),
      event: {
        aggregateType: 'employee',
        aggregateId: shift.employeeId,
        eventType: 'ShiftEndsSoon',
        payload: eventPayload(facts, notice),
      },
    },
  ]);
  return true;
}

export async function suppressShiftEndingSoon(
  tx: Tx,
  ids: IdGenerator,
  companyId: string,
  write: ShiftEndSuppressedWrite,
): Promise<boolean> {
  const id = ids.newId();
  const { shift } = write;
  const inserted = await tx.execute<{ id: string }>(sql`
    INSERT INTO attendance_shift_ending_notices(
      company_id,id,business_id,branch_id,employee_id,shift_starts_at,shift_ends_at,remind_due_at,notified_at,recipient_count,suppressed_at)
    VALUES(${companyId},${id},${shift.businessId},${shift.branchId},${shift.employeeId},
      ${shift.startsAt.toISOString()},${shift.endsAt.toISOString()},${write.remindAt.toISOString()},
      ${write.detectedAt.toISOString()},0,${write.detectedAt.toISOString()})
    ON CONFLICT (company_id, employee_id, shift_ends_at) DO NOTHING RETURNING id`);
  return inserted.length === 1;
}

function noticeFacts(id: string, notice: ShiftEndNoticeWrite) {
  const { shift } = notice;
  return {
    notice_id: id,
    employee_id: shift.employeeId,
    business_id: shift.businessId,
    branch_id: shift.branchId,
    shift_starts_at: shift.startsAt.toISOString(),
    shift_ends_at: shift.endsAt.toISOString(),
    remind_at: notice.remindAt.toISOString(),
    detected_at: notice.detectedAt.toISOString(),
  };
}

// المستلم الواحد هو الموظفة نفسها على قناة الدفع؛ مفيش هاتف ولا لغة، والـ deadline هو نهاية الوردية
// فالتأخير في الطابور ميبعتش «دوامك قرب يخلص» بعد ما الوردية خلصت (ADR-0052 §5).
function eventPayload(facts: ReturnType<typeof noticeFacts>, notice: ShiftEndNoticeWrite) {
  if (notice.userId === null) return facts;
  return {
    ...facts,
    notification_recipients: [
      {
        channel: 'PUSH' as const,
        user_id: notice.userId,
        template_key: 'shift_ends_soon' as const,
        template_revision: 1 as const,
        safe_parameters: notice.parameters,
        send_deadline: notice.shift.endsAt.toISOString(),
      },
    ],
  };
}
