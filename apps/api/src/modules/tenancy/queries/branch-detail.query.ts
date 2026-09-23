import type { Branch } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';

// Screen: admin › branch settings. One branch by its primary key (company_id, id); the row is the Branch contract.
// effective_timezone is D-10 in SQL: the branch's own, else its business's (domain/time-zone.ts says the same).
export async function branchDetail(
  db: TenantWrappers,
  access: { companyId: string; userId: string },
  branchId: string,
): Promise<Branch | null> {
  const [row] = await db.withTenant(
    access.companyId,
    async (tx) =>
      Array.from(
        await tx.execute<Branch>(sql`
          SELECT b.id, b.company_id, b.business_id, b.name_ar, b.name_en, b.address_ar, b.address_en,
                 CASE WHEN b.geo_lat IS NULL THEN NULL
                      ELSE json_build_object('lat', b.geo_lat, 'lng', b.geo_lng) END AS geo,
                 b.opening_hours, b.timezone,
                 COALESCE(b.timezone, bu.timezone) AS effective_timezone,
                 b.is_active, to_json(b.created_at) #>> '{}' AS created_at
          FROM branches b
          JOIN businesses bu ON bu.company_id = b.company_id AND bu.id = b.business_id
          WHERE b.company_id = ${access.companyId} AND b.id = ${branchId}`),
      ),
    { userId: access.userId },
  );
  return row ?? null;
}
