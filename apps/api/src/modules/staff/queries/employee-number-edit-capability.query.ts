import { employeeNumberEditCapability, type EmployeeNumberEditCapability } from '@pospay/contracts';
import { currentAttachment, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

export const EMPLOYEE_NUMBER_EDIT_CAPABILITY_ACCESS = Symbol(
  'EMPLOYEE_NUMBER_EDIT_CAPABILITY_ACCESS',
);

/** منفذ إعادة الفحص بجوار الاستعلام حتى لا يعتمد مسار القراءة على ports/ أو use-cases/. */
export interface EmployeeNumberEditCapabilityAccess {
  /** يعيد قرار FR-006 على نشاط الموظفة وكل فرع حالي بلا قفل الشركة. */
  recheck(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
    branchIds: readonly string[],
  ): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
}

export type EmployeeNumberEditCapabilityResult =
  EmployeeNumberEditCapability | 'NOT_FOUND' | 'FEATURE_DISABLED';

export function employeeNumberEditEmployeeStatement(
  companyId: string,
  businessId: string,
  employeeId: string,
) {
  // ملف الموظف: نشاط مختلف أو حذف ناعم يبدوان غياباً حتى لا يكشف المسار وجود الصف.
  return sql`SELECT business_id, primary_branch_id FROM employees
    WHERE company_id=${companyId} AND id=${employeeId} AND business_id=${businessId}
      AND deleted_at IS NULL`;
}

export function employeeNumberEditAttachmentStatement(companyId: string, employeeId: string) {
  // ملف الموظف: الارتباط الحالي يبقى في نطاق الإذن ما دام تاريخ نهايته لاحقاً.
  return sql`SELECT eb.branch_id FROM employee_branches eb
    WHERE eb.company_id=${companyId} AND eb.employee_id=${employeeId} AND ${currentAttachment()}`;
}

function editBranchTargets(primaryBranchId: string, attached: readonly string[]): string[] {
  // نفس ترتيب تعديل الرقم: الفرع الرئيسي يبقى حتى بعد نهاية ارتباطه، ثم كل ارتباط حالي غير مكرر.
  const branches = [primaryBranchId];
  for (const branchId of attached) if (!branches.includes(branchId)) branches.push(branchId);
  return branches;
}

export async function readEmployeeNumberEditCapability(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  employeeId: string,
  access: EmployeeNumberEditCapabilityAccess,
): Promise<EmployeeNumberEditCapabilityResult> {
  const [row] = await tx.execute<{ business_id: string; primary_branch_id: string }>(
    employeeNumberEditEmployeeStatement(companyId, businessId, employeeId),
  );
  if (row === undefined) return 'NOT_FOUND';
  const attached = await tx.execute<{ branch_id: string }>(
    employeeNumberEditAttachmentStatement(companyId, employeeId),
  );
  const decision = await access.recheck(
    tx,
    companyId,
    userId,
    row.business_id,
    editBranchTargets(
      row.primary_branch_id,
      attached.map((link) => link.branch_id),
    ),
  );
  if (decision === 'FEATURE_DISABLED') return 'FEATURE_DISABLED';
  return employeeNumberEditCapability.parse({ can_edit_number: decision === null });
}
