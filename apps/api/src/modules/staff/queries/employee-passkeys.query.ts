import { employeePasskeyHistory, type PasskeyHistoryQuery } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { bindingStatus } from './passkey-binding.query.ts';
import { managerPasskeyEmployee, type ManagerPasskeyAccess } from './passkey-access.ts';

// صفحة الموظف تعرض تاريخ الربط فقط؛ لا credential ولا reason حر في إسقاط الشاشة.
export function passkeyHistoryStatement(
  companyId: string,
  employeeId: string,
  query: PasskeyHistoryQuery,
) {
  return sql`SELECT id AS binding_id,revision,
    to_char(bound_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS bound_at,
    to_char(unbound_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS unbound_at
    FROM employee_passkeys WHERE company_id=${companyId} AND employee_id=${employeeId}
      ${query.cursor === undefined ? sql`` : sql`AND id<${query.cursor}`}
    ORDER BY id DESC LIMIT ${query.limit + 1}`;
}
export async function employeePasskeys(
  tx: Tx,
  scope: { companyId: string; businessId: string; employeeId: string; userId: string },
  query: PasskeyHistoryQuery,
  access: ManagerPasskeyAccess,
) {
  const employee = await managerPasskeyEmployee(tx, scope, access);
  if (employee === null) return null;
  if (!employee.featureEnabled) return 'FEATURE_DISABLED' as const;
  const rows = await tx.execute<{ binding_id: string }>(
    passkeyHistoryStatement(scope.companyId, scope.employeeId, query),
  );
  const items = rows.slice(0, query.limit);
  return employeePasskeyHistory.parse({
    status: await bindingStatus(tx, scope.companyId, scope.employeeId),
    can_unbind: employee.unbindAllowed && !employee.ownBinding,
    items,
    next_cursor: rows.length > query.limit ? (items.at(-1)?.binding_id ?? null) : null,
  });
}
