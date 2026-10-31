import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * اسما النشاط بالعرض، لأن رسالة التقييم تسمية النشاط بلغة العميل.
 *
 * @param tx معاملة المستأجر
 * @param companyId الشركة المالكة للنشاط
 * @param businessId النشاط المطلوب
 * @returns الاسم العربي والإنجليزي، أو null إن لم يوجد النشاط
 */
export async function businessNames(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<{ name_ar: string | null; name_en: string } | null> {
  const rows = await tx.execute<{ name_ar: string | null; name_en: string }>(sql`
    SELECT name_ar, name_en FROM businesses WHERE company_id = ${companyId} AND id = ${businessId}`);
  const row = rows[0];
  if (row === undefined) return null;
  return { name_ar: row.name_ar, name_en: row.name_en };
}
