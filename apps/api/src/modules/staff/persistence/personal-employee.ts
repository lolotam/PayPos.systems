import type { TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { personalMemberships } from '../../identity/index.ts';
import { personalMember } from '../domain/passkey-binding.ts';

/** employee_id يؤخذ من ربط المستخدم الموثق؛ لا يقبله هذا القارئ من المتصفح. */
export async function personalEmployee(
  tx: Tx,
  userId: string,
  workspace: { companyId: string; businessId: string },
  lock = false,
) {
  const { companyId, businessId } = workspace;
  const memberships = await personalMemberships(tx, companyId, userId, lock);
  const [employee] = await tx.execute<{ id: string; primary_branch_id: string }>(sql`
    SELECT id,primary_branch_id FROM employees WHERE company_id=${companyId}
      AND business_id=${businessId} AND user_id=${userId} AND deleted_at IS NULL ${lock ? sql`FOR UPDATE` : sql``}`);
  if (employee === undefined) return null;
  const attached = await tx.execute<{
    branch_id: string;
  }>(sql`SELECT branch_id FROM employee_branches
    WHERE company_id=${companyId} AND employee_id=${employee.id}
      AND "from"<=CURRENT_DATE AND ("to" IS NULL OR "to">CURRENT_DATE)`);
  return personalMember(
    companyId,
    businessId,
    [employee.primary_branch_id, ...attached.map((r) => r.branch_id)],
    memberships,
  )
    ? employee.id
    : null;
}

/** قبل الإثبات لا نعيد بيانات الموظف للعميل؛ نتيجة الاستعداد والأهلية فقط. */
export function createPersonalEligibility(database: TenantWrappers) {
  const employee = (
    userId: string,
    workspace: { companyId: string; businessId: string },
    deadline?: Date,
  ) =>
    database.withTenant(
      workspace.companyId,
      (tx) => personalEmployee(tx, userId, workspace),
      deadline === undefined
        ? {}
        : { timeoutMs: Math.max(1, deadline.getTime() - Date.now()), drainOnTimeout: true },
    );
  return {
    employee,
    eligible: async (
      userId: string,
      workspace: { companyId: string; businessId: string },
      deadline?: Date,
    ) => (await employee(userId, workspace, deadline)) !== null,
    deviceValid: async () => true,
  };
}
