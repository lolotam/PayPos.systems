import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
/** يقفل أسماء الخدمات المحددة بالهوية فقط؛ المال يظل من لقطة المعاينة ولا يعاد تسعيره. */
export async function readPackageCommitServices(
  tx: Tx,
  companyId: string,
  businessId: string,
  serviceIds: readonly string[],
) {
  const ids = [...new Set(serviceIds)].sort();
  const result: { id: string; name_en: string; name_ar: string | null }[] = [];
  for (let start = 0; start < ids.length; start += 500) {
    const batch = ids.slice(start, start + 500);
    const rows = await tx.execute<{ id: string; name_en: string; name_ar: string | null }>(sql`
      SELECT id,name_en,name_ar FROM services WHERE company_id=${companyId} AND business_id=${businessId}
      AND id=ANY(ARRAY[${sql.join(
        batch.map((id) => sql`${id}`),
        sql`, `,
      )}]::uuid[]) ORDER BY id FOR SHARE`);
    result.push(...rows);
  }
  return result;
}
