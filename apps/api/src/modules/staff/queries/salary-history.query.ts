import { salaryHistoryPage, type SalaryHistoryQuery } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
export const SALARY_ACCESS = Symbol('SALARY_ACCESS');
/** قراءة الصلاحية داخل المعاملة دون ربط الاستعلام بطبقات الكتابة. */
export interface SalaryAccess {
  /** يقيم الصلاحية عند الفروع المحفوظة، دون كشف وجود راتب. */
  check(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
    branchIds: readonly string[],
  ): Promise<{ read: boolean; manage: boolean; featureEnabled: boolean }>;
}
// قسم الراتب في محرر الموظف؛ المؤشر تاريخ فريد للموظف، والرفض يسبق قراءة أي مبلغ.
export async function salaryHistory(
  tx: Tx,
  context: { companyId: string; userId: string; businessId: string; employeeId: string },
  query: SalaryHistoryQuery,
  access: SalaryAccess,
) {
  const { companyId, businessId, employeeId, userId } = context;
  const [employee] = await tx.execute<{ branch_ids: string[] }>(sql`SELECT
    ARRAY(SELECT eb.branch_id FROM employee_branches eb WHERE eb.company_id=e.company_id AND eb.employee_id=e.id AND eb."to" IS NULL) || ARRAY[e.primary_branch_id] AS branch_ids
    FROM employees e WHERE e.company_id=${companyId} AND e.business_id=${businessId} AND e.id=${employeeId} AND e.deleted_at IS NULL`);
  if (employee === undefined) return null;
  const decision = await access.check(tx, companyId, userId, businessId, employee.branch_ids);
  if (!decision.read) return null;
  if (!decision.featureEnabled) return 'FEATURE_DISABLED' as const;
  const rows =
    await tx.execute(sql`SELECT id, employee_id, to_char(effective_from,'YYYY-MM-DD') AS effective_from, amount::text AS amount, set_by, revision, reason
    FROM employee_salaries WHERE company_id=${companyId} AND employee_id=${employeeId}
    ${query.cursor === undefined ? sql`` : sql`AND effective_from < ${query.cursor}::date`}
    ORDER BY effective_from DESC LIMIT ${query.limit + 1}`);
  const items = rows.slice(0, query.limit);
  return salaryHistoryPage.parse({
    items,
    next_cursor: rows.length > query.limit ? items.at(-1)?.['effective_from'] : null,
    can_manage: decision.manage,
  });
}
