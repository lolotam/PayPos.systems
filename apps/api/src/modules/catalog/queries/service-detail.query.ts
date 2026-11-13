import type { Service } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { toService, type ServiceDetailRow } from './service-projection.ts';

// شاشة تعديل الخدمة: الانضمام LEFT JOIN عشان تسمية التصنيف وإغلاقه يوصلوا مع الخدمة نفسها.
export function serviceDetailStatement(companyId: string, businessId: string, serviceId: string) {
  return sql`
    SELECT s.id,s.business_id,s.name_en,s.name_ar,s.price,s.commission_rule_kind,s.commission_pct_bps,
      s.commission_fixed_amount,s.counts_toward_threshold,s.duration_minutes,s.category_id,s.revision,
      to_char(s.closed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS closed_at,
      to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
      to_char(s.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at,
      c.name_en AS category_name_en,c.name_ar AS category_name_ar,
      to_char(c.closed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS category_closed_at
    FROM services s
    LEFT JOIN service_categories c ON c.company_id=s.company_id AND c.business_id=s.business_id AND c.id=s.category_id
    WHERE s.company_id=${companyId} AND s.business_id=${businessId} AND s.id=${serviceId}`;
}

// الغياب ونشاط تاني نفس الرد عشان مايكشفش وجود صف شركة تانية.
export async function serviceDetail(
  tx: Tx,
  companyId: string,
  businessId: string,
  serviceId: string,
): Promise<Service | null> {
  const rows = await tx.execute<ServiceDetailRow>(
    serviceDetailStatement(companyId, businessId, serviceId),
  );
  const row = rows[0];
  return row === undefined ? null : toService(row);
}
