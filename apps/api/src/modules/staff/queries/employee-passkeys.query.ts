import { employeePasskeyHistory, type PasskeyHistoryQuery } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
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
// شاشة الموظف تميز الهاتف المقفول منذ التسجيل عن الربط القديم الملحق عند الحضور.
export function passkeyStatusStatement(companyId: string, employeeId: string) {
  return sql`
    SELECT p.id AS binding_id,p.revision,to_char(p.bound_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS bound_at,
      p.installation_hash IS NOT NULL AS phone_locked,
      CASE WHEN p.installation_hash IS NOT NULL AND EXISTS (
        SELECT 1 FROM audit_log a WHERE a.company_id=p.company_id AND a.entity='employee_passkey'
          AND a.entity_id=p.id AND a.action='bound' AND a.after->>'phone_locked'='true'
      ) THEN to_char(p.bound_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END AS phone_locked_since
    FROM employee_passkeys p WHERE p.company_id=${companyId} AND p.employee_id=${employeeId} AND p.unbound_at IS NULL`;
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
  const [phone] = await tx.execute<{
    binding_id: string;
    revision: number;
    bound_at: string;
    phone_locked: boolean;
    phone_locked_since: string | null;
  }>(passkeyStatusStatement(scope.companyId, scope.employeeId));
  return employeePasskeyHistory.parse({
    status:
      phone === undefined
        ? {
            bound: false,
            binding_id: null,
            revision: null,
            bound_at: null,
            phone_locked: false,
            phone_locked_since: null,
          }
        : { bound: true, ...phone },
    can_unbind: employee.unbindAllowed && !employee.ownBinding,
    items,
    next_cursor: rows.length > query.limit ? (items.at(-1)?.binding_id ?? null) : null,
  });
}
