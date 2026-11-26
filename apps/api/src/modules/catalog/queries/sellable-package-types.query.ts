import {
  sellablePackageTypePage,
  type SellablePackageTypeListQuery,
  type SellablePackageTypePage,
} from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

export const SELLABLE_PACKAGE_PLACE = Symbol('SELLABLE_PACKAGE_PLACE');
export type SellablePackagePlace = (
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
) => Promise<string | null>;

// فورم بيع الباقة في الاستقبال بيقرأ الأنواع المتاحة مع أسعار ومراجعات مكوناتها الحالية؛
// النوع اللي فيه خدمة مقفولة بيختفي لأن بيعه ممنوع (SI-Q28).
export function sellablePackageTypesStatement(
  companyId: string,
  businessId: string,
  query: SellablePackageTypeListQuery,
) {
  return sql`SELECT p.id,p.revision,p.name_en,p.name_ar,p.price::text,p.validity_days,
    (SELECT jsonb_agg(jsonb_build_object('service_id',c.service_id,'service_revision',s.revision,
      'name_en',s.name_en,'name_ar',s.name_ar,'sessions',c.sessions,'list_price',s.price::text)
      ORDER BY c.position)
      FROM package_type_components c JOIN services s ON s.company_id=c.company_id
        AND s.business_id=c.business_id AND s.id=c.service_id
      WHERE c.company_id=p.company_id AND c.business_id=p.business_id AND c.package_type_id=p.id) AS components
    FROM package_types p
    WHERE p.company_id=${companyId} AND p.business_id=${businessId} AND p.selling_stopped_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM package_type_components k JOIN services ks
        ON ks.company_id=k.company_id AND ks.business_id=k.business_id AND ks.id=k.service_id
        WHERE k.company_id=p.company_id AND k.business_id=p.business_id
          AND k.package_type_id=p.id AND ks.closed_at IS NOT NULL)
    ${query.cursor === undefined ? sql`` : sql`AND p.id > ${query.cursor}`}
    ORDER BY p.id LIMIT ${query.limit + 1}`;
}

export async function listSellablePackageTypes(
  tx: Tx,
  companyId: string,
  businessId: string,
  query: SellablePackageTypeListQuery,
): Promise<SellablePackageTypePage> {
  const rows = await tx.execute(sellablePackageTypesStatement(companyId, businessId, query));
  const items = rows.slice(0, query.limit);
  return sellablePackageTypePage.parse({
    items,
    next_cursor: rows.length > query.limit ? items.at(-1)?.['id'] : null,
  });
}
