import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** تواريخ عمل موظفة كما يطلبها اعتماد كشف العمولة، بصيغة YYYY-MM-DD. */
export interface StaffEmploymentDates {
  readonly hireDate: string;
  readonly contractEnd: string | null;
  readonly deletedOn: string | null;
}

/**
 * يعيد تواريخ تعيين وانتهاء عقد وحذف الموظفات المطلوبات، بمن فيهن المحذوفات؛ يوم الحذف يُحوَّل من لحظة الحذف إلى
 * تاريخ النشاط المحلي، لأن شهر الكشف شهر النشاط لا شهر UTC. موظفة لا تنتمي للنشاط لا تظهر في النتيجة.
 *
 * @param tx معاملة بسياق الشركة
 * @param companyId الشركة
 * @param businessId النشاط
 * @param employeeIds الموظفات المطلوبة
 * @returns خريطة من هوية الموظفة إلى تواريخ عملها
 */
export async function readEmployeeEmploymentDates(
  tx: Tx,
  companyId: string,
  businessId: string,
  employeeIds: readonly string[],
): Promise<ReadonlyMap<string, StaffEmploymentDates>> {
  if (employeeIds.length === 0) return new Map();
  const rows = await tx.execute<{
    id: string;
    hire_date: string;
    contract_end: string | null;
    deleted_on: string | null;
  }>(sql`SELECT e.id, e.hire_date::text AS hire_date, e.contract_end::text AS contract_end,
      (e.deleted_at AT TIME ZONE b.timezone)::date::text AS deleted_on
    FROM employees e JOIN businesses b ON b.company_id = e.company_id AND b.id = e.business_id
    WHERE e.company_id = ${companyId} AND e.business_id = ${businessId}
      AND e.id IN (SELECT jsonb_array_elements_text(${JSON.stringify(employeeIds)}::jsonb)::uuid)`);
  return new Map(
    rows.map((row) => [
      row.id,
      { hireDate: row.hire_date, contractEnd: row.contract_end, deletedOn: row.deleted_on },
    ]),
  );
}
