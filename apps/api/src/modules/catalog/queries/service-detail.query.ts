import type { Service } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { toService, type ServiceDetailRow } from './service-projection.ts';

export function serviceDetailStatement(companyId: string, businessId: string, serviceId: string) {
  return sql`
    SELECT id,business_id,name_en,name_ar,price,commission_rule_kind,commission_pct_bps,
      commission_fixed_amount,counts_toward_threshold,revision,
      to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
      to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
    FROM services WHERE company_id=${companyId} AND business_id=${businessId} AND id=${serviceId}`;
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
