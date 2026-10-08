import {
  packageTypePage,
  type PackageTypeListQuery,
  type PackageTypePage,
} from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// شاشة قائمة الباقات تقرأ العدد مع كل صف في استعلام واحد وترتب بمفتاح النشاط والمعرف.
export function listPackageTypesStatement(
  companyId: string,
  businessId: string,
  query: PackageTypeListQuery,
) {
  return sql`SELECT p.id,p.name_en,p.name_ar,p.price,p.validity_days,p.revision,
    (SELECT count(*)::int FROM package_type_components c WHERE c.company_id=p.company_id
      AND c.business_id=p.business_id AND c.package_type_id=p.id) AS component_count
    FROM package_types p WHERE p.company_id=${companyId} AND p.business_id=${businessId}
    ${query.cursor === undefined ? sql`` : sql`AND p.id > ${query.cursor}`}
    ORDER BY p.id LIMIT ${query.limit + 1}`;
}

export async function listPackageTypes(
  tx: Tx,
  companyId: string,
  businessId: string,
  query: PackageTypeListQuery,
): Promise<PackageTypePage> {
  const rows = await tx.execute(listPackageTypesStatement(companyId, businessId, query));
  const items = rows.slice(0, query.limit);
  return packageTypePage.parse({
    items,
    next_cursor: rows.length > query.limit ? items.at(-1)?.['id'] : null,
  });
}
