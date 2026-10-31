import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// صفحة التقييم العامة بتعرض اسم النشاط للزائرة، بالعربي أو بالإنجليزي حسب لغة العميل (spec 060 D-B9).
export async function businessNames(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<{ name_ar: string | null; name_en: string } | null> {
  const [row] = await tx.execute<{ name_ar: string | null; name_en: string }>(
    sql`SELECT name_ar, name_en FROM businesses WHERE company_id=${companyId} AND id=${businessId}`,
  );
  if (row === undefined) return null;
  return { name_ar: row.name_ar, name_en: row.name_en };
}
