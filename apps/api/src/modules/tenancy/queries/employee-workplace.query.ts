import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// شاشة إنشاء الموظف تحتاج وجود النشاط وتبعية الفرع، دون قراءة أسماء أو بيانات الموظفين.
export async function employeeWorkplace(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
) {
  const [business] = await tx.execute<{ id: string }>(sql`SELECT id
    FROM businesses WHERE company_id=${companyId} AND id=${businessId}`);
  const [branch] = await tx.execute<{ business_id: string }>(
    sql`SELECT business_id FROM branches WHERE company_id=${companyId} AND id=${branchId}`,
  );
  return {
    businessExists: business !== undefined,
    branchBusinessId: branch?.business_id ?? null,
  };
}
