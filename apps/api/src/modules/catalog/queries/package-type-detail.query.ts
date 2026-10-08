import { packageTypeDetail, type PackageTypeDetail } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// شاشة التعديل تعرض أسماء الخدمات وأسعارها الحالية للتحذير من الجلسات المجانية؛ السعر نص داخل JSON.
export function packageTypeDetailStatement(
  companyId: string,
  businessId: string,
  packageTypeId: string,
) {
  return sql`SELECT p.id,p.business_id,p.name_en,p.name_ar,p.price,p.validity_days,p.revision,
    to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
    to_char(p.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at,
    (SELECT jsonb_agg(jsonb_build_object('service_id',c.service_id,'sessions',c.sessions,
      'name_en',s.name_en,'name_ar',s.name_ar,'price',s.price::text) ORDER BY c.position)
      FROM package_type_components c JOIN services s ON s.company_id=c.company_id
        AND s.business_id=c.business_id AND s.id=c.service_id
      WHERE c.company_id=p.company_id AND c.business_id=p.business_id AND c.package_type_id=p.id) AS components
    FROM package_types p WHERE p.company_id=${companyId} AND p.business_id=${businessId} AND p.id=${packageTypeId}`;
}

export async function getPackageTypeDetail(
  tx: Tx,
  companyId: string,
  businessId: string,
  packageTypeId: string,
): Promise<PackageTypeDetail | null> {
  const [row] = await tx.execute(packageTypeDetailStatement(companyId, businessId, packageTypeId));
  return row === undefined ? null : packageTypeDetail.parse(row);
}
