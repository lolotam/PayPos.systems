import { employeePage, type EmployeeListQuery, type EmployeePage } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { EmployeeDetailAccess } from './employee-detail.query.ts';

// جدول الموظفين يقسم الصفحات بعد تصفية النطاق؛ المؤشر لا يحمل معرف موظف ممنوع.
export function listEmployeesStatement(
  companyId: string,
  businessId: string,
  query: EmployeeListQuery,
  allowedBranches: readonly string[],
) {
  return sql`WITH allowed_branches AS (SELECT jsonb_array_elements_text(${JSON.stringify(allowedBranches)}::jsonb)::uuid AS id)
    SELECT e.id,e.name_ar,e.name_en,e.role_code,e.primary_branch_id,to_char(e.hire_date,'YYYY-MM-DD') AS hire_date
    FROM employees e WHERE e.company_id=${companyId} AND e.business_id=${businessId} AND e.deleted_at IS NULL
    AND e.primary_branch_id IN (SELECT id FROM allowed_branches)
    AND NOT EXISTS (SELECT 1 FROM employee_branches eb WHERE eb.company_id=e.company_id AND eb.employee_id=e.id AND eb."to" IS NULL AND eb.branch_id NOT IN (SELECT id FROM allowed_branches))
    ${query.cursor === undefined ? sql`` : sql`AND e.id > ${query.cursor}`} ORDER BY e.id LIMIT ${query.limit + 1}`;
}

// قائمة واحدة باستعلام موظفين واحد، وفحص الصلاحيات دفعة واحدة عبر حد الهوية قبل القراءة.
export async function listEmployees(
  tx: Tx,
  companyId: string,
  businessId: string,
  userId: string,
  query: EmployeeListQuery,
  access: EmployeeDetailAccess,
): Promise<EmployeePage | 'FEATURE_DISABLED'> {
  const decision = await access.listScope(tx, companyId, userId, businessId);
  if (decision.allowedBranchIds.length === 0) return { items: [], next_cursor: null };
  if (!decision.featureEnabled) return 'FEATURE_DISABLED';
  const rows = await tx.execute<{ id: string }>(
    listEmployeesStatement(companyId, businessId, query, decision.allowedBranchIds),
  );
  const items = rows.slice(0, query.limit);
  return employeePage.parse({
    items,
    next_cursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
  });
}
