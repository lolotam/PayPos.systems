import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** اسما الموظفة كما هما مخزّنان: العربي اختياري والإنجليزي لازم. */
export interface EmployeeDisplayName {
  readonly name_ar: string | null;
  readonly name_en: string;
}

/**
 * بيرجّع أسماء الموظفات المطلوبة بمعرّفاتها في قراءة واحدة، عشان قارئ التقييمات يعرض الاسم من غير ما يقرأ جدول staff.
 * الموظفة المحذوفة بتتجاب برضه، لأن التقييم القديم لسه بيشير لها.
 *
 * @param tx          معاملة القراءة على الشركة
 * @param companyId   الشركة المؤكدة من الجلسة
 * @param employeeIds معرّفات الموظفات المطلوبة
 * @returns الاسمان لكل موظفة موجودة بمعرّفها؛ المعرّف اللي مالوش موظفة ما بيظهرش
 */
export async function readEmployeeDisplayNames(
  tx: Tx,
  companyId: string,
  employeeIds: readonly string[],
): Promise<ReadonlyMap<string, EmployeeDisplayName>> {
  if (employeeIds.length === 0) return new Map();
  const rows = await tx.execute<{ id: string; name_ar: string | null; name_en: string }>(sql`
    SELECT id, name_ar, name_en FROM employees
    WHERE company_id = ${companyId}
      AND id IN (${sql.join(
        employeeIds.map((employeeId) => sql`${employeeId}::uuid`),
        sql`, `,
      )})`);
  return new Map(rows.map((row) => [row.id, { name_ar: row.name_ar, name_en: row.name_en }]));
}
