import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** الخدمات المفتوحة للنشاط لمطابقة أسماء ملف الاستيراد (SI-Q28: المقفولة لا تظهر ولا تُحتسب غموضاً)؛ السعر لقطة عرض ولا يوزن التوزيع. */
export async function readPackageImportServices(tx: Tx, companyId: string, businessId: string) {
  return tx.execute<{ id: string; name_en: string; name_ar: string | null; price: string }>(sql`
    SELECT id,name_en,name_ar,price::text FROM services
    WHERE company_id=${companyId} AND business_id=${businessId} AND closed_at IS NULL ORDER BY id`);
}
