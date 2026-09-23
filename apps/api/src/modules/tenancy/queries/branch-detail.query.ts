import type { Branch } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';

// Screen: admin › branch settings. One branch by its primary key (company_id, id); the row is the Branch contract.
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
          SELECT id, company_id, business_id, name_ar, name_en, address_ar, address_en,
                 CASE WHEN geo_lat IS NULL THEN NULL
                      ELSE json_build_object('lat', geo_lat, 'lng', geo_lng) END AS geo,
                 opening_hours, is_active, to_json(created_at) #>> '{}' AS created_at
          FROM branches
          WHERE company_id = ${access.companyId} AND id = ${branchId}`),
      ),
    { userId: access.userId },
  );
  return row ?? null;
}
