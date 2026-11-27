import {
  staffAccessGrantedEventPayload,
  staffPinRecoveredEventPayload,
  staffPinSetByOtherEventPayload,
} from '@pospay/contracts';
import type { ClaimedEvent } from '@pospay/db';

import type { RequestStaffAccessNotice } from '../../use-cases/request-staff-access-notice/request-staff-access-notice.ts';

async function dispatchStaffPinNotice(
  useCase: RequestStaffAccessNotice,
  event: ClaimedEvent,
  kind: 'staff_pin_set_by_other' | 'staff_pin_recovered',
  schema: typeof staffPinSetByOtherEventPayload,
): Promise<void> {
  const parsed = schema.safeParse(event.payload);
  if (!parsed.success) throw new Error('STAFF_ACCESS_EVENT_INVALID');
  if (event.aggregateType !== 'employee' || parsed.data.employee_id !== event.aggregateId)
    throw new Error('STAFF_ACCESS_EVENT_INVALID');
  await useCase.execute({
    kind,
    companyId: event.companyId,
    sourceEventId: event.id,
    employeeId: parsed.data.employee_id,
    userId: parsed.data.user_id,
    branchId: parsed.data.branch_id,
    actorUserId: parsed.data.actor_user_id,
    occurredAt:
      parsed.data.occurred_at === undefined ? undefined : new Date(parsed.data.occurred_at),
  });
}

/**
 * يستقبل أحداث وصول الدخول (منح الدخول وإعادة ضبط الرقم السري واستعادته بنفسها) ويحوّلها لطلب جرس المالك.
 * الحدث لازم يكون عن الموظفة نفسها اللي في الـ aggregate، وإلا فالمعطيات غلط والفشل يبقى ظاهر.
 *
 * @param useCase طلب الجرس
 * @param event الحدث المسلّم من المرسِل
 * @returns اكتمال الطلب
 */
export async function onStaffAccessNotice(
  useCase: RequestStaffAccessNotice,
  event: ClaimedEvent,
): Promise<void> {
  if (event.eventType === 'StaffAccessGranted') {
    const parsed = staffAccessGrantedEventPayload.safeParse(event.payload);
    if (!parsed.success) throw new Error('STAFF_ACCESS_EVENT_INVALID');
    if (event.aggregateType !== 'employee' || parsed.data.employee_id !== event.aggregateId)
      throw new Error('STAFF_ACCESS_EVENT_INVALID');
    await useCase.execute({
      kind: 'staff_access_granted',
      companyId: event.companyId,
      sourceEventId: event.id,
      employeeId: parsed.data.employee_id,
      userId: parsed.data.user_id,
      branchId: parsed.data.branch_id,
      actorUserId: parsed.data.actor_user_id,
      occurredAt:
        parsed.data.occurred_at === undefined ? undefined : new Date(parsed.data.occurred_at),
    });
    return;
  }
  if (event.eventType === 'StaffPinSetByOther') {
    await dispatchStaffPinNotice(
      useCase,
      event,
      'staff_pin_set_by_other',
      staffPinSetByOtherEventPayload,
    );
    return;
  }
  if (event.eventType === 'StaffPinRecovered') {
    await dispatchStaffPinNotice(
      useCase,
      event,
      'staff_pin_recovered',
      staffPinRecoveredEventPayload,
    );
  }
}
