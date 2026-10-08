import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * أهلية الشركة على معاملة المستدعي حتى لا تسجل الوظيفة إشعاراً لشركة محذوفة.
 *
 * @param tx معاملة المستأجر الحالية، بما فيها إعادة الفحص بعد قفل الموظف
 * @param companyId الشركة المجدولة
 * @returns هل الشركة موجودة وغير محذوفة داخل المستأجر
 */
export async function companyOpen(tx: Tx, companyId: string): Promise<boolean> {
  const rows = await tx.execute(sql`SELECT id FROM companies
    WHERE id = ${companyId} AND deleted_at IS NULL`);
  return rows.length > 0;
}
