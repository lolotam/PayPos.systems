import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * بيقفل صف الشركة النشطة FOR SHARE لحد ما معاملة القرار تتسجل.
 * القفل بيتعارض مع UPDATE الحذف الناعم ومش بيتعارض مع قارئ تاني،
 * ولو نفس المعاملة ماسكة قفل أقوى على الصف القفل ده بيتاخد من غير تعارض ذاتي.
 *
 * @param tx        معاملة القرار
 * @param companyId الشركة
 * @returns true لما الصف ظاهر وdeleted_at فاضي
 */
export async function lockActiveCompany(tx: Tx, companyId: string): Promise<boolean> {
  const rows = await tx.execute(
    sql`SELECT id FROM companies WHERE id=${companyId} AND deleted_at IS NULL FOR SHARE`,
  );
  return rows.length === 1;
}
