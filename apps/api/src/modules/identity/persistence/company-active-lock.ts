import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * بيقفل صف الشركة النشطة FOR KEY SHARE لحد ما معاملة القرار تتسجل.
 * القفل مش بيتعارض مع FOR NO KEY UPDATE بتاع كتابات الوصول، فالقراية مش بتستنى الكتابة.
 * أي حذف ناعم للشركة لازم يقفل الصف FOR UPDATE قبل ما يكتب deleted_at،
 * عشان الحذف يستنى قرارات الوصول الشغالة وكل قرار بعدها يترفض.
 * نفس المعاملة لو ماسكة قفل أقوى على الصف بتاخد القفل ده من غير تعارض ذاتي.
 *
 * @param tx        معاملة القرار
 * @param companyId الشركة
 * @returns true لما الصف ظاهر وdeleted_at فاضي
 */
export async function lockActiveCompany(tx: Tx, companyId: string): Promise<boolean> {
  const rows = await tx.execute(
    sql`SELECT id FROM companies WHERE id=${companyId} AND deleted_at IS NULL FOR KEY SHARE`,
  );
  return rows.length === 1;
}
