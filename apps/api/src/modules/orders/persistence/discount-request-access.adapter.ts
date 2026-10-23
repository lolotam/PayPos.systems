import type { Tx } from '@pospay/db';
import { lockServiceSessionAccess, readServiceSessionAccess } from '../../identity/index.ts';
import type { DiscountRequestAccessPort } from '../ports/discount-request.port.ts';

/**
 * يصل طلب الموافقة بسلطة التسجيل نفسها التي تحمي التسجيل، فالمطلوب لا يُنفّذ بلا إذن التسجيل.
 * القراءة ترجع أدوار العضويات أيضاً لأن لقطة دور الطالبة تُحفظ مع الطلب (D-18).
 *
 * @param tx معاملة الشركة المستهلكة
 * @param companyId الشركة المؤكدة
 * @param userId مستخدمة حساب admin
 * @param businessId النشاط الذي أثبته tenancy
 * @param branchId فرع الزيارة
 * @returns منفذ قفل وقراءة سلطة التسجيل
 */
export function discountRequestAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
): DiscountRequestAccessPort {
  return {
    lock: () => lockServiceSessionAccess(tx, companyId),
    read: (at) => readServiceSessionAccess(tx, companyId, userId, businessId, branchId, at),
  };
}
