import { employee, type Employee } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// شاشة تأكيد إنشاء الموظف؛ كل حقول الاستجابة إسقاط صريح داخل نشاط واحد دون رواتب أو اعتمادات.
export async function employeeDetail(
  tx: Tx,
  companyId: string,
  businessId: string,
  employeeId: string,
): Promise<Employee | null> {
  const [row] =
    await tx.execute(sql`SELECT id, business_id, primary_branch_id, user_id, name_ar, name_en,
    role_code, to_char(hire_date, 'YYYY-MM-DD') AS hire_date, to_char(contract_end, 'YYYY-MM-DD') AS contract_end,
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
    FROM employees WHERE company_id=${companyId} AND business_id=${businessId} AND id=${employeeId} AND deleted_at IS NULL`);
  return row === undefined ? null : employee.parse(row);
}
