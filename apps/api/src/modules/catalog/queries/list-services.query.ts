import { servicePage, type ServiceListQuery, type ServicePage } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { toServiceListItem, type ServiceListRow } from './service-projection.ts';

// شاشة قائمة الخدمات: صفحة واحدة باستعلام واحد مفهرس على (company_id, business_id, id)؛
// قراءة فقط ولا تمر على domain/ أو use-cases/.
export function listServicesStatement(
  companyId: string,
  businessId: string,
  query: ServiceListQuery,
) {
  return sql`SELECT id,name_en,name_ar,price,commission_rule_kind,commission_pct_bps,
      commission_fixed_amount,counts_toward_threshold,revision
    FROM services WHERE company_id=${companyId} AND business_id=${businessId}
    ${query.cursor === undefined ? sql`` : sql`AND id > ${query.cursor}`}
    ORDER BY id LIMIT ${query.limit + 1}`;
}

// صفحة واحدة لكل شاشة؛ المؤشر معرف خدمة مش موجود في الصفحة الجاية.
export async function listServices(
  tx: Tx,
  companyId: string,
  businessId: string,
  query: ServiceListQuery,
): Promise<ServicePage> {
  const rows = await tx.execute<ServiceListRow>(
    listServicesStatement(companyId, businessId, query),
  );
  const items = rows.slice(0, query.limit).map(toServiceListItem);
  return servicePage.parse({
    items,
    next_cursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
  });
}
