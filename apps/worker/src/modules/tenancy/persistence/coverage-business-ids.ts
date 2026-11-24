import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** كل أنشطة الشركة بلا فلترة حالة؛ نطاق جزئي لا يكفي لإثبات الشركة كلها. */
export async function coverageBusinessIds(tx: Tx, companyId: string): Promise<readonly string[]> {
  const rows = await tx.execute<{ id: string }>(sql`SELECT id FROM businesses
    WHERE company_id = ${companyId} AND company_id = app_company_id() ORDER BY id`);
  return rows.map((row) => row.id);
}
