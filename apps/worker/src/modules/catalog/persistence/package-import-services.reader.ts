import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** خدمات النشاط لمطابقة أسماء ملف الاستيراد؛ السعر لقطة عرض ولا يوزن التوزيع. */
export async function readPackageImportServices(tx: Tx, companyId: string, businessId: string) {
  return tx.execute<{ id: string; name_en: string; name_ar: string | null; price: string }>(sql`
    SELECT id,name_en,name_ar,price::text FROM services
    WHERE company_id=${companyId} AND business_id=${businessId} ORDER BY id`);
}
