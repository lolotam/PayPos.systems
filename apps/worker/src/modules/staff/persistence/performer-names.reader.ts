import { sql } from 'drizzle-orm';
import type { Tx } from '@pospay/db';

/** اسم موظف بلغتي العرض كما هو مخزّن، قبل قواعد العرض. */
export interface StoredEmployeeName {
  readonly employeeId: string;
  readonly nameAr: string | null;
  readonly nameEn: string | null;
}

/**
 * يقرأ أسماء الموظفين المطلوبة بلغتي العرض، لأن الاسم في رسالة التقييم بلغة العميل.
 *
 * @param tx معاملة المستأجر
 * @param companyId الشركة المالكة للموظفين
 * @param employeeIds معرّفات الموظفين المطلوبين
 * @returns أسماء الموظفين المخزّنة؛ الموظف بلا اسم عربي يظهر باسم عربي فارغ
 */
export async function readEmployeeDisplayNames(
  tx: Tx,
  companyId: string,
  employeeIds: readonly string[],
): Promise<readonly StoredEmployeeName[]> {
  if (employeeIds.length === 0) return [];
  const rows = await tx.execute<{
    id: string;
    name_ar: string | null;
    name_en: string | null;
  }>(sql`
    SELECT id, name_ar, name_en
      FROM employees
     WHERE company_id = ${companyId}
       AND id IN (${sql.join(employeeIds.map((employeeId) => sql`${employeeId}::uuid`), sql`, `)})`);
  return rows.map((row) => ({
    employeeId: row.id,
    nameAr: row.name_ar,
    nameEn: row.name_en,
  }));
}
