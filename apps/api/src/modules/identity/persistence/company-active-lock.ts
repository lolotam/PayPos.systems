import type { Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

function activeCompany(companyId: string, lock: SQL) {
  return sql`SELECT id FROM companies WHERE id=${companyId} AND deleted_at IS NULL${lock}`;
}

/**
 * بيفحص صف الشركة من غير قفل.
 * مسارات القراءة ممنوعة تستنى أي قفل؛ الكتابة متسلسلة لأن إعادة الفحص بتمسك
 * الصف FOR NO KEY UPDATE في نفس المعاملة عن طريق lock*Access، والقفل ده بيتعارض
 * مع أي UPDATE للصف بما فيه الحذف الناعم، فالحذف مش يقدر يتسجل بين الفحص والكتابة.
 *
 * @param tx        معاملة القراءة
 * @param companyId الشركة
 * @returns true لما الصف ظاهر وdeleted_at فاضي
 */
export async function companyIsActive(tx: Tx, companyId: string): Promise<boolean> {
  const rows = await tx.execute(activeCompany(companyId, sql``));
  return rows.length === 1;
}

/**
 * بيقفل صف الشركة النشطة FOR KEY SHARE لحد ما معاملة التسجيل أو الـ PIN تتسجل.
 * القفل لمسارات مش بتعدّي على lock*Access. مش بيتعارض مع FOR NO KEY UPDATE،
 * فالقراية دي مش بتستنى كتابات الوصول. أي حذف ناعم لازم يقفل الصف FOR UPDATE
 * قبل ما يكتب deleted_at، عشان الحذف يستنى القرار الشغال وكل قرار بعده يترفض.
 * نفس المعاملة لو ماسكة قفل أقوى على الصف بتاخد القفل ده من غير تعارض ذاتي.
 *
 * @param tx        معاملة التسجيل أو التحقق من الـ PIN
 * @param companyId الشركة
 * @returns true لما الصف ظاهر وdeleted_at فاضي
 */
export async function lockActiveCompany(tx: Tx, companyId: string): Promise<boolean> {
  const rows = await tx.execute(activeCompany(companyId, sql` FOR KEY SHARE`));
  return rows.length === 1;
}
