import type { Tx } from '@pospay/db';

import {
  lockBusinessPermissionAccess,
  readBusinessPermissionAccess,
} from './business-permission-access.ts';

const PERMISSION = 'manage:imported-refunds:business';

/**
 * بيقفل الشركة النشطة ثم العضويات ثم النشاط قبل كتابة مفتاح مرتجع الباقات المستوردة.
 * نفس ترتيب أقفال هوية النشاط عشان كتّاب إعدادات النشاط يستنوا على بعضهم بالترتيب نفسه،
 * والشركة المحذوفة أو النشاط الغايب بيترفضوا من غير ما يتكشف وجودهم.
 *
 * @param tx معاملة كتابة المفتاح
 * @param companyId الشركة المتحقق منها
 * @param userId المستخدم
 * @param businessId النشاط
 * @returns FORBIDDEN أو null بعد القرار تحت الأقفال
 */
export async function lockImportedRefundsAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
): Promise<'FORBIDDEN' | null> {
  return lockBusinessPermissionAccess(tx, PERMISSION, companyId, userId, businessId);
}

/**
 * بيعيد قرار صلاحية مفتاح المرتجعات المستوردة بعد قفل صف الإعدادات، من غير أقفال جديدة.
 * الرفض اللي بيجي بعد الانتظار هو اللي بيكسب: سحب التفويض اللي اتعمل أثناء الانتظار يمنع الكتابة.
 *
 * @param tx معاملة الشركة والأقفال السابقة لسه قايمة
 * @param companyId الشركة
 * @param userId المستخدم
 * @param businessId النشاط
 * @returns FORBIDDEN أو null عند السماح
 */
export async function readImportedRefundsAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
): Promise<'FORBIDDEN' | null> {
  return readBusinessPermissionAccess(tx, PERMISSION, companyId, userId, businessId);
}
