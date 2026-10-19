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
 * بيقفل صف الشركة FOR SHARE لحد ما معاملة إصدار أو قبول بيانات الاعتماد تتسجل.
 * التسجيل والمطالبة بتوكن الجهاز والـ PIN بيصدروا أو بيقبلوا اعتماد، فلازم القفل
 * يتعارض مع UPDATE عادي للصف (FOR NO KEY UPDATE) ومع FOR UPDATE، عشان أي حذف ناعم
 * يستنى القرار من غير قفل FOR UPDATE مخصوص.
 *
 * @param tx        معاملة الاعتماد
 * @param companyId الشركة
 * @returns true لما الصف ظاهر وdeleted_at فاضي
 */
export async function lockCredentialCompany(tx: Tx, companyId: string): Promise<boolean> {
  const rows = await tx.execute(activeCompany(companyId, sql` FOR SHARE`));
  return rows.length === 1;
}
