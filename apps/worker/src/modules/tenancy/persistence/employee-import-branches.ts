import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// KEY SHARE يمنع الحذف أو تغيير المفتاح حتى نهاية معاملة الوظيفة؛ الفرع غير النشط مقبول كإنشاء الموظف.
export async function employeeImportBranches(
  tx: Tx,
  businessId: string,
): Promise<readonly string[]> {
  const rows = await tx.execute<{ id: string }>(sql`SELECT id FROM branches
    WHERE company_id=app_company_id() AND business_id=${businessId} ORDER BY id FOR KEY SHARE`);
  return rows.map((row) => row.id);
}
