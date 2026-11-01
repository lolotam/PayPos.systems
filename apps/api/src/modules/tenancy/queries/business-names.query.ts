import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// صفحة التقييم العامة بتعرض اسم النشاط للزائرة، بالعربي أو بالإنجليزي حسب لغة العميل (spec 060 D-B9).
export function businessNamesStatement(companyId: string, businessId: string) {
  return sql`SELECT name_ar, name_en FROM businesses WHERE company_id=${companyId} AND id=${businessId}`;
}

export async function businessNames(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<{ name_ar: string | null; name_en: string } | null> {
  const [row] = await tx.execute<{ name_ar: string | null; name_en: string }>(
    businessNamesStatement(companyId, businessId),
  );
  if (row === undefined) return null;
  return { name_ar: row.name_ar, name_en: row.name_en };
}

// أسماء نشاطات كثيرة في قراءة واحدة: ملاحظات العميل ممكن تكون لأنشطة مختلفة (CI-Q17).
export function businessNamesByIdsStatement(companyId: string, businessIds: readonly string[]) {
  return sql`SELECT id, name_ar, name_en FROM businesses
    WHERE company_id=${companyId}
      AND id = ANY(ARRAY[${sql.join(
        businessIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}]::uuid[])`;
}

export async function businessNamesByIds(
  tx: Tx,
  companyId: string,
  businessIds: readonly string[],
): Promise<{ id: string; name_ar: string | null; name_en: string }[]> {
  if (businessIds.length === 0) return [];
  const rows = await tx.execute<{ id: string; name_ar: string | null; name_en: string }>(
    businessNamesByIdsStatement(companyId, businessIds),
  );
  return Array.from(rows);
}
