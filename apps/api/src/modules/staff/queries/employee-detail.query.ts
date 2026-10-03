import { employee, type Employee } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

export const EMPLOYEE_DETAIL_ACCESS = Symbol('EMPLOYEE_DETAIL_ACCESS');
/** منفذ القراءة بجوار الاستعلام مثل WorkspaceNames، حتى لا يعتمد مسار القراءة على ports/ أو domain/. */
export interface EmployeeDetailAccess {
  /** يفحص النطاق المحفوظ داخل نفس معاملة القراءة؛ المنع يسبق كشف السجل أو حالة الميزة. */
  check(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
    branchId: string,
  ): Promise<'ALLOWED' | 'DENIED' | 'FEATURE_DISABLED'>;
}

// شاشة تأكيد الموظف؛ لا يخرج الإسقاط إلا بعد فحص الإذن عند الفرع الأساسي المحفوظ، والرفض يشبه الغياب.
export async function employeeDetail(
  tx: Tx,
  companyId: string,
  businessId: string,
  employeeId: string,
  userId: string,
  access: EmployeeDetailAccess,
): Promise<Employee | 'FEATURE_DISABLED' | null> {
  const [row] = await tx.execute<{
    business_id: string;
    primary_branch_id: string;
  }>(sql`SELECT id, business_id, primary_branch_id, user_id, name_ar, name_en,
    role_code, to_char(hire_date, 'YYYY-MM-DD') AS hire_date, to_char(contract_end, 'YYYY-MM-DD') AS contract_end,
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
    FROM employees WHERE company_id=${companyId} AND business_id=${businessId} AND id=${employeeId} AND deleted_at IS NULL`);
  if (row === undefined) return null;
  const decision = await access.check(
    tx,
    companyId,
    userId,
    row.business_id,
    row.primary_branch_id,
  );
  if (decision === 'DENIED') return null;
  if (decision === 'FEATURE_DISABLED') return decision;
  return employee.parse(row);
}
