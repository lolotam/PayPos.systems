import { passkeyEmployeePage, type PasskeyHistoryQuery } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { currentAttachment, type BranchDay, type ManagerPasskeyAccess } from './passkey-access.ts';

// قائمة صفحة الموظفين مستقلة عن سلطة التعديل؛ كل الفروع المحفوظة مصفّاة قبل المؤشر.
export function passkeyEmployeesStatement(
  companyId: string,
  businessId: string,
  branchIds: readonly string[],
  query: PasskeyHistoryQuery,
  days: readonly BranchDay[],
) {
  const branches = sql`ARRAY[${sql.join(
    branchIds.map((id) => sql`${id}::uuid`),
    sql`,`,
  )}]::uuid[]`;
  return sql`SELECT id,name_en,name_ar,primary_branch_id FROM employees e
    WHERE company_id=${companyId} AND business_id=${businessId} AND deleted_at IS NULL
      AND primary_branch_id=ANY(${branches})
      AND NOT EXISTS(SELECT 1 FROM employee_branches eb WHERE eb.company_id=e.company_id AND eb.employee_id=e.id
        AND ${currentAttachment(days)} AND NOT (eb.branch_id=ANY(${branches})))
      ${query.cursor === undefined ? sql`` : sql`AND id>${query.cursor}`}
    ORDER BY id LIMIT ${query.limit + 1}`;
}
export async function passkeyEmployees(
  tx: Tx,
  scope: { companyId: string; businessId: string; userId: string },
  query: PasskeyHistoryQuery,
  access: ManagerPasskeyAccess,
) {
  const decision = await access.list(tx, scope.companyId, scope.userId, scope.businessId);
  if (decision.readBranchIds.length === 0)
    return passkeyEmployeePage.parse({ items: [], next_cursor: null });
  if (!decision.featureEnabled) return 'FEATURE_DISABLED' as const;
  const days = await access.branchDays(tx, scope.companyId, scope.businessId);
  const rows = await tx.execute<{ id: string }>(
    passkeyEmployeesStatement(
      scope.companyId,
      scope.businessId,
      decision.readBranchIds,
      query,
      days,
    ),
  );
  const items = rows.slice(0, query.limit);
  return passkeyEmployeePage.parse({
    items,
    next_cursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
  });
}
