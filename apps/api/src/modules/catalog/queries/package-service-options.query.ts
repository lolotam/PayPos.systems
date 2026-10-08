import {
  packageServiceOptionPage,
  type PackageServiceOptionPage,
  type PackageTypeListQuery,
} from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// شاشة مكوّنات الباقة تحتاج الأسماء والسعر فقط؛ الخدمات لا تدعم الإيقاف حالياً فكل خيار نشط.
export function packageServiceOptionsStatement(
  companyId: string,
  businessId: string,
  query: PackageTypeListQuery,
) {
  return sql`SELECT id,name_ar,name_en,price,true AS active
    FROM services WHERE company_id=${companyId} AND business_id=${businessId}
    ${query.cursor === undefined ? sql`` : sql`AND id > ${query.cursor}`}
    ORDER BY id LIMIT ${query.limit + 1}`;
}

export async function listPackageServiceOptions(
  tx: Tx,
  companyId: string,
  businessId: string,
  query: PackageTypeListQuery,
): Promise<PackageServiceOptionPage> {
  const rows = await tx.execute(packageServiceOptionsStatement(companyId, businessId, query));
  const items = rows.slice(0, query.limit);
  return packageServiceOptionPage.parse({
    items,
    next_cursor: rows.length > query.limit ? items.at(-1)?.['id'] : null,
  });
}
