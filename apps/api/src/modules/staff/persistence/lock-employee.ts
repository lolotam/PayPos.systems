import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** يقفل الموظفة النشطة للكتابة المتسلسلة عليها من مستهلك آخر داخل معاملته نفسها. */
export async function lockEmployeeForUpdate(
  tx: Tx,
  companyId: string,
  businessId: string,
  employeeId: string,
): Promise<boolean> {
  // FOR NO KEY UPDATE بيسلسل كتابة الخطط من غير ما يعطل إدخالات FK اللي بتاخد FOR KEY SHARE.
  const rows = await tx.execute(sql`SELECT id FROM employees
    WHERE company_id=${companyId} AND business_id=${businessId} AND id=${employeeId}
      AND deleted_at IS NULL FOR NO KEY UPDATE`);
  return rows.length === 1;
}
