import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** نشاط من أنشطة الشركة مع منطقته الزمنية. */
export interface CompanyBusiness {
  readonly id: string;
  readonly timeZone: string;
}

/**
 * أنشطة الشركة مع مناطقها الزمنية، للشركة غير المحذوفة فقط. المنطقة الزمنية IANA
 * بتاع النشاط هي اللي بتحدد يوم التذكير والتوقيت المحلي (FR-053).
 *
 * @param tx        معاملة الشركة الحالية
 * @param companyId الشركة
 * @returns الأنشطة مع مناطقها الزمنية
 */
export async function companyBusinesses(
  tx: Tx,
  companyId: string,
): Promise<readonly CompanyBusiness[]> {
  const rows = await tx.execute<{ id: string; timezone: string }>(sql`SELECT b.id, b.timezone
    FROM businesses b
    JOIN companies c ON c.id = b.company_id AND c.deleted_at IS NULL
    WHERE b.company_id = ${companyId}
    ORDER BY b.id`);
  return rows.map((row) => ({ id: row.id, timeZone: row.timezone }));
}
