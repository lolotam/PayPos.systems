import { sql } from 'drizzle-orm';

import type { Tx } from '@pospay/db';

/**
 * يقرأ هوية النشاط الثابتة حتى بعد حذف الموظف منطقيًا، لاستعادة أحداث الراتب التاريخية.
 *
 * @param tx معاملة المستأجر التي يملكها المستدعي
 * @param companyId الشركة المالكة للموظف
 * @param employeeId معرّف الموظف التاريخي
 * @returns معرّف النشاط فقط، أو null عند غياب الموظف ضمن عزل المعاملة
 */
export async function readEmployeeBusiness(
  tx: Tx,
  companyId: string,
  employeeId: string,
): Promise<string | null> {
  const rows = await tx.execute<{ business_id: string }>(sql`
    SELECT business_id
      FROM employees
     WHERE company_id = ${companyId}
       AND id = ${employeeId}`);
  return rows[0]?.business_id ?? null;
}
