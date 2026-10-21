import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

type Row = { staff_columns: string[] | null; staff_months_back: number | null };

/**
 * The stored staff-app columns and months back, without a lock; a missing row is two nulls and the read never
 * creates one.
 *
 * @param tx         the caller's tenant transaction
 * @param companyId  the verified company
 * @param businessId the business
 * @returns what is stored; null means the default
 */
export async function storedStaffColumnsQuery(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<{ columns: string[] | null; monthsBack: number | null }> {
  // شاشة «أعمدة تطبيق الموظفين» في لوحة التحكم (57c-2).
  const [row] = await tx.execute<Row>(sql`
    SELECT staff_columns, staff_months_back FROM business_settings
    WHERE company_id = ${companyId} AND business_id = ${businessId}`);
  return { columns: row?.staff_columns ?? null, monthsBack: row?.staff_months_back ?? null };
}
