import { staffAccessGrantedEventPayload, staffPinSetByOtherEventPayload } from '@pospay/contracts';
import type { ClaimedEvent } from '@pospay/db';

import type { RequestStaffAccessNotice } from '../../use-cases/request-staff-access-notice/request-staff-access-notice.ts';

/**
 * يستقبل حدثي وصول الدخول (منح الدخول وإعادة ضبط الرقم السري) ويحوّلهما لطلب جرس المالك.
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
    });
    return;
  }
  if (event.eventType === 'StaffPinSetByOther') {
    const parsed = staffPinSetByOtherEventPayload.safeParse(event.payload);
    if (!parsed.success) throw new Error('STAFF_ACCESS_EVENT_INVALID');
    if (event.aggregateType !== 'employee' || parsed.data.employee_id !== event.aggregateId)
      throw new Error('STAFF_ACCESS_EVENT_INVALID');
    await useCase.execute({
      kind: 'staff_pin_set_by_other',
      companyId: event.companyId,
      sourceEventId: event.id,
      employeeId: parsed.data.employee_id,
      userId: parsed.data.user_id,
      branchId: parsed.data.branch_id,
    });
    return;
  }
}
