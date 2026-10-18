import { employeeNumberCapability, type EmployeeNumberCapability } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

export const EMPLOYEE_NUMBER_CAPABILITY_ACCESS = Symbol('EMPLOYEE_NUMBER_CAPABILITY_ACCESS');

/** منفذ القراءة بجوار الاستعلام حتى لا يعتمد مسار المعاينة على ports/ أو use-cases/. */
export interface EmployeeNumberCapabilityAccess {
  /** يثبت manage:employees:business على النشاط والفرع الأساسي قبل إظهار المعاينة. */
  employees(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
    branchId: string,
  ): Promise<{ allowed: boolean; featureEnabled: boolean }>;
  /** يقرر كتابة الرقم على النشاط والفرع الأساسي بلا أقفال؛ المنع إجابة كاذبة لا رفضاً. */
  number(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
    branchId: string,
  ): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
}

export type EmployeeNumberCapabilityResult =
  | EmployeeNumberCapability
  | 'EMPLOYEE_BRANCH_NOT_FOUND'
  | 'FORBIDDEN'
  | 'FEATURE_DISABLED';

export function employeeNumberCapabilityBranchStatement(
  companyId: string,
  businessId: string,
  branchId: string,
) {
  // نموذج إضافة الموظف
  return sql`SELECT b.id FROM branches b
    INNER JOIN businesses bu ON bu.company_id=b.company_id AND bu.id=b.business_id
    WHERE b.company_id=${companyId} AND b.id=${branchId} AND b.business_id=${businessId}`;
}

export async function readEmployeeNumberCapability(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
  access: EmployeeNumberCapabilityAccess,
): Promise<EmployeeNumberCapabilityResult> {
  const [branch] = await tx.execute<{ id: string }>(
    employeeNumberCapabilityBranchStatement(companyId, businessId, branchId),
  );
  if (branch === undefined) return 'EMPLOYEE_BRANCH_NOT_FOUND';
  const employees = await access.employees(tx, companyId, userId, businessId, branchId);
  if (!employees.allowed) return 'FORBIDDEN';
  if (!employees.featureEnabled) return 'FEATURE_DISABLED';
  const decision = await access.number(tx, companyId, userId, businessId, branchId);
  if (decision === 'FEATURE_DISABLED') return 'FEATURE_DISABLED';
  return employeeNumberCapability.parse({ can_type_number: decision === null });
}
