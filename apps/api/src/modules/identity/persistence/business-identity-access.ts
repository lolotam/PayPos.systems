import type { Tx } from '@pospay/db';

import {
  lockBusinessPermissionAccess,
  readBusinessPermissionAccess,
} from './business-permission-access.ts';

const PERMISSION = 'manage:business-identity:business';

/**
 * بيقفل الشركة النشطة ثم العضويات ثم النشاط قبل كتابة الاسم الرسمي.
 * الشركة المحذوفة أو النشاط الغايب بيترفضوا من غير ما يتكتب صف إعدادات، عشان الوجود ما يتكشفش.
 *
 * @param tx معاملة تعديل الهوية
 * @param companyId الشركة المتحقق منها
 * @param userId المستخدم
 * @param businessId النشاط
 * @returns FORBIDDEN أو null بعد القرار تحت الأقفال
 */
export async function lockBusinessIdentityAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
): Promise<'FORBIDDEN' | null> {
  return lockBusinessPermissionAccess(tx, PERMISSION, companyId, userId, businessId);
}

/**
 * بيعيد قرار صلاحية هوية النشاط بعد قفل صف الإعدادات، من غير أقفال جديدة.
 * وقت القرار هو وقت المعاملة بعد الانتظار، وصلاحية النشاط ما بتمشيش على منع فرع.
 *
 * @param tx معاملة الشركة والأقفال السابقة لسه قايمة
 * @param companyId الشركة
 * @param userId المستخدم
 * @param businessId النشاط
 * @returns FORBIDDEN أو null عند السماح
 */
export async function readBusinessIdentityAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
): Promise<'FORBIDDEN' | null> {
  return readBusinessPermissionAccess(tx, PERMISSION, companyId, userId, businessId);
}
