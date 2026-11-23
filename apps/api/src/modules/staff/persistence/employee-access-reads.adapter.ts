import type { Tx } from '@pospay/db';

import { readStaffAccessAuthority, readStaffAccessState, readStaffUser } from '../../identity/index.ts';
import type { StaffUserFacade } from '../../identity/index.ts';

/**
 * قراءات شاشة دخول الموظفة: الحالة والسلطة تعبر identity على معاملة المستدعِ، وحساب الدخول يعبر
 * identity إلى packages/auth — سهم staff → identity المعلن (plan §2.2). الشكل البنيوي يطابق واجهة
 * الاستعلام `EmployeeAccessStateReads` جنب ملف queries دون استيراد بين الطبقتين.
 *
 * @param auth واجهة packages/auth على pospay_auth
 * @returns القراءات الثلاثة للاستعلام
 */
export function createEmployeeAccessStateReads(auth: StaffUserFacade) {
  return {
    state: (
      tx: Tx,
      input: { companyId: string; businessId: string; employeeId: string },
    ) => readStaffAccessState(tx, input),
    authority: (
      tx: Tx,
      input: { companyId: string; actorUserId: string; businessId: string; branchId: string },
    ) => readStaffAccessAuthority(tx, input),
    staffUser: (operationId: string) => readStaffUser(auth, operationId),
  };
}
