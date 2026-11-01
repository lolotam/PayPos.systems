import { servicePage, type ServiceListQuery, type ServicePage } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { toServiceListItem, type ServiceListRow } from './service-projection.ts';

// شاشة قائمة الخدمات: ترتيب المعرّف يطابق الفهرس ويحفظ استقرار الصفحات، والفلتر بالتصنيف يقرأ الفهرس الجديد.
export function listServicesStatement(
  companyId: string,
  businessId: string,
  query: ServiceListQuery,
) {
  return sql`SELECT s.id,s.name_en,s.name_ar,s.price,s.commission_rule_kind,s.commission_pct_bps,
      s.commission_fixed_amount,s.counts_toward_threshold,s.duration_minutes,s.category_id,s.revision,
      c.name_en AS category_name_en,c.name_ar AS category_name_ar,
      to_char(c.closed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS category_closed_at
    FROM services s
    LEFT JOIN service_categories c ON c.company_id=s.company_id AND c.business_id=s.business_id AND c.id=s.category_id
    WHERE s.company_id=${companyId} AND s.business_id=${businessId}
    ${query.cursor === undefined ? sql`` : sql`AND s.id > ${query.cursor}`}
    ${query.category_id === undefined ? sql`` : sql`AND s.category_id = ${query.category_id}`}
    ORDER BY s.id LIMIT ${query.limit + 1}`;
}

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
