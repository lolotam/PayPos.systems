import { currentAttachment, type Tx } from '@pospay/db';
import { employeePage, type EmployeeListQuery, type EmployeePage } from '@pospay/contracts';
import { parseEmployeeNumber } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import { icuNameMatch } from '../../../shared/name-options-search.ts';
import type { EmployeeDetailAccess } from './employee-detail.query.ts';

// قائمة الموظفين في لوحة الإدارة، وخانة البحث فيها.
// نص الأرقام يطابق الرقم بالمفتاح الفريد أو الاسم؛ الحروف الاسم فقط. الطي والهروب هما نفس منتقي الاستقبال حتى لا يطابق 2 الرقم 12 ولا تتحول % إلى بدل.
function listSearchClause(companyId: string, q: string | undefined) {
  if (q === undefined) return sql``;
  const nameMatch = icuNameMatch(q);
  const employeeNumber = parseEmployeeNumber(q.trim());
  return employeeNumber === null
    ? sql`AND ${nameMatch}`
    : sql`AND (${nameMatch} OR e.id IN (SELECT numbered.id FROM employees numbered WHERE numbered.company_id=${companyId} AND numbered.employee_number=${employeeNumber}))`;
}

// قائمة الموظفين تقسم الصفحات بعد نطاق الفروع؛ خانة البحث والفلتر الرقمي يبقيان داخل هذا النطاق حتى لا يظهر صف ممنوع.
export function listEmployeesStatement(
  companyId: string,
  businessId: string,
  query: EmployeeListQuery,
  allowedBranches: readonly string[],
) {
  return sql`WITH allowed_branches AS (SELECT jsonb_array_elements_text(${JSON.stringify(allowedBranches)}::jsonb)::uuid AS id)
    SELECT e.id,e.name_ar,e.name_en,e.role_code,e.primary_branch_id,to_char(e.hire_date,'YYYY-MM-DD') AS hire_date,e.employee_number
    FROM employees e WHERE e.company_id=${companyId} AND e.business_id=${businessId} AND e.deleted_at IS NULL
    AND e.primary_branch_id IN (SELECT id FROM allowed_branches)
    AND NOT EXISTS (SELECT 1 FROM employee_branches eb WHERE eb.company_id=e.company_id AND eb.employee_id=e.id AND ${currentAttachment()} AND eb.branch_id NOT IN (SELECT id FROM allowed_branches))
    ${query.employee_number === undefined ? sql`` : sql`AND e.id=(SELECT numbered.id FROM employees numbered WHERE numbered.company_id=${companyId} AND numbered.employee_number=${query.employee_number})`}
    ${listSearchClause(companyId, query.q)}
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
