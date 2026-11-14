import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// النسخة العاملة من apps/api/src/modules/tenancy/queries/package-sale-place.query.ts لتوقيت فرع البيع النشط.
export async function packageSalePlace(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
): Promise<string | null> {
  const [row] = await tx.execute<{ timezone: string | null }>(sql`
    SELECT COALESCE(b.timezone, bu.timezone) AS timezone
    FROM branches b
    JOIN businesses bu ON bu.company_id = b.company_id AND bu.id = b.business_id
    JOIN companies c ON c.id = b.company_id AND c.deleted_at IS NULL
    WHERE b.company_id = ${companyId} AND b.business_id = ${businessId}
      AND b.id = ${branchId} AND b.is_active`);
  return row?.timezone ?? null;
}
