import type { Tx } from '@pospay/db';
import { lockServiceSessionAccess, readPackageSaleAccess } from '../../identity/index.ts';
import type { SessionRecordAccessPort } from '../ports/session-readers.port.ts';

/**
 * صلاحية بيع الباقة على الفرع؛ القفل عام على الشركة والعضويات والقراءة بصلاحية البيع.
 *
 * @param tx معاملة بيع الباقة
 * @param companyId الشركة المؤكدة
 * @param userId مستخدمة حساب admin
 * @param businessId النشاط المطلوب
 * @param branchId فرع البيع
 * @returns قارئ السلطة؛ نفس شكل قارئ التسجيل عشان `resolveSessionRecorder` يشتغل عليه زي ما هو
 */
export function packageSaleAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
): SessionRecordAccessPort {
  return {
    lock: () => lockServiceSessionAccess(tx, companyId),
    read: (at) => readPackageSaleAccess(tx, companyId, userId, businessId, branchId, at),
  };
}
