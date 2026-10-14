import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// مكان جلسة الخدمة وإثبات الاسترداد: توقيت النشاط لفرع نشط تحت هذا النشاط في شركة غير محذوفة.
export function activeBusinessTimeZoneStatement(
  companyId: string,
  businessId: string,
  branchId: string,
) {
  return sql`
    SELECT bu.timezone
    FROM branches b
    JOIN businesses bu ON bu.company_id = b.company_id AND bu.id = b.business_id
    JOIN companies c ON c.id = b.company_id AND c.deleted_at IS NULL
    WHERE b.company_id = ${companyId} AND b.business_id = ${businessId}
      AND b.id = ${branchId} AND b.is_active`;
}

export async function activeBusinessTimeZone(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
): Promise<string | null> {
  const [row] = await tx.execute<{ timezone: string | null }>(
    activeBusinessTimeZoneStatement(companyId, businessId, branchId),
  );
  return row?.timezone ?? null;
}
