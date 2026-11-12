import type { Tx } from '@pospay/db';
import { lockServiceSessionEditAccess, readLineAccess } from './service-session-edit-access.ts';

/**
 * يثبت الشركة ثم عضويات تمديد الباقة بنفس ترتيب أقفال كتابة السطر.
 *
 * @param tx معاملة الشركة المستهلكة
 * @param companyId الشركة المؤكدة
 * @returns اكتمال قفل الشركة ثم العضويات حتى نهاية المعاملة
 */
export async function lockPackageExtensionAccess(tx: Tx, companyId: string): Promise<void> {
  await lockServiceSessionEditAccess(tx, companyId);
}

/**
 * يعيد منع تمديد الباقة، وميزة الطلبات، وقراءة الزيارات، والعضويات المؤهلة على الفرع.
 * ترتيب العضويات بمعرّفها يجعل أول مؤهلة هي المنسوب إليها التمديد عند تعدد العضويات.
 *
 * @param tx معاملة المستهلك نفسها
 * @param companyId الشركة المؤكدة
 * @param userId مستخدمة التمديد
 * @param businessId النشاط الذي أثبته النطاق
 * @param branchId الفرع الذي يحدث فيه التمديد
 * @param at اللحظة المحقونة بعد الأقفال
 * @returns المنع والميزة وحق القراءة والعضويات المؤهلة بذاتها
 */
export async function readPackageExtensionAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
  at: Date,
) {
  return readLineAccess(tx, 'extend:packages:branch', companyId, userId, businessId, branchId, at);
}
