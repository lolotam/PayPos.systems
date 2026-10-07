import { employeeCardsView, type EmployeeCardsView } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** قراءة السلطة على فروع الموظف المحفوظة دون ربط الاستعلام بطبقات الكتابة. */
export interface EmployeeCardReadAccess {
  /** يقيّم الصلاحية عند الفروع المحفوظة، دون كشف وجود الموظف. */
  read(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
    branchIds: readonly string[],
  ): Promise<{ manage: boolean; featureEnabled: boolean }>;
}

// شاشة كارت الموظف: الفحص على الفروع المحفوظة يسبق أي كشف، والرفض يطابق غياب الموظف.
export async function readEmployeeCards(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  employeeId: string,
  access: EmployeeCardReadAccess,
): Promise<EmployeeCardsView | 'FEATURE_DISABLED' | null> {
  const branches = await persistedBranches(tx, companyId, businessId, employeeId);
  if (branches === null) return null;
  const decision = await access.read(tx, companyId, userId, businessId, branches);
  if (!decision.manage) return null;
  if (!decision.featureEnabled) return 'FEATURE_DISABLED';
  return employeeCardsView.parse({
    active: await activeCard(tx, companyId, businessId, employeeId),
    can_manage: true,
  });
}

async function persistedBranches(
  tx: Tx,
  companyId: string,
  businessId: string,
  employeeId: string,
): Promise<readonly string[] | null> {
  const [employee] = await tx.execute<{ branch_ids: string[] }>(sql`
    SELECT ARRAY(SELECT eb.branch_id FROM employee_branches eb
      WHERE eb.company_id=e.company_id AND eb.employee_id=e.id AND eb."to" IS NULL)
      || ARRAY[e.primary_branch_id] AS branch_ids
    FROM employees e WHERE e.company_id=${companyId} AND e.business_id=${businessId}
      AND e.id=${employeeId} AND e.deleted_at IS NULL`);
  return employee === undefined ? null : employee.branch_ids;
}

/** شاشة كارت الموظف: الكارت النشط فقط، بلا الكود الخام. */
export function activeEmployeeCardStatement(
  companyId: string,
  businessId: string,
  employeeId: string,
) {
  return sql`SELECT id,employee_id,card_code_suffix,issued_at,revoked_at FROM employee_cards
    WHERE company_id=${companyId} AND business_id=${businessId} AND employee_id=${employeeId}
      AND revoked_at IS NULL`;
}

async function activeCard(tx: Tx, companyId: string, businessId: string, employeeId: string) {
  const [row] = await tx.execute<{
    id: string;
    employee_id: string;
    card_code_suffix: string;
    issued_at: Date;
    revoked_at: Date | null;
  }>(activeEmployeeCardStatement(companyId, businessId, employeeId));
  if (row === undefined) return null;
  return {
    id: row.id,
    employee_id: row.employee_id,
    card_code_suffix: row.card_code_suffix,
    issued_at: new Date(row.issued_at).toISOString(),
    revoked_at: row.revoked_at === null ? null : new Date(row.revoked_at).toISOString(),
  };
}
