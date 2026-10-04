import { sharedInstallationFlagPage, type SharedInstallationFlagPage } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** PR27 يمرر نطاقات الفروع المتحقق منها ونافذة السياسة؛ الإشارة لا تمنح سلطة قراءة بذاتها. */
export interface SharedInstallationQuery {
  companyId: string;
  branchIds: readonly string[];
  from: Date;
  to: Date;
  windowMs: number;
  limit: number;
  cursor?: { first: string; second: string };
}
// مجلس الحضور PR27 يعرض أزواجاً داخل نطاقه؛ كلا الموظفين مرئي، ولا يخرج hash.
export function sharedInstallationsStatement(query: SharedInstallationQuery) {
  const branches = sql`ARRAY[${sql.join(
    query.branchIds.map((id) => sql`${id}::uuid`),
    sql`,`,
  )}]::uuid[]`;
  return sql`SELECT a.id AS first_signal_id,b.id AS second_signal_id,
    a.employee_id AS first_employee_id,b.employee_id AS second_employee_id,
    a.branch_id AS first_branch_id,b.branch_id AS second_branch_id,
    to_char(a.clocked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS first_clocked_at,
    to_char(b.clocked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS second_clocked_at
    FROM attendance_device_signals a JOIN attendance_device_signals b
      ON b.company_id=a.company_id AND b.installation_hash=a.installation_hash
      AND b.employee_id<>a.employee_id AND (b.clocked_at,b.id)>(a.clocked_at,a.id)
      AND b.clocked_at<=a.clocked_at+(${query.windowMs} * interval '1 millisecond')
    WHERE a.company_id=${query.companyId}
      AND a.branch_id=ANY(${branches}) AND b.branch_id=ANY(${branches})
      AND a.clocked_at>=${query.from.toISOString()} AND b.clocked_at<${query.to.toISOString()}
      ${query.cursor === undefined ? sql`` : sql`AND (a.id,b.id)>(${query.cursor.first}::uuid,${query.cursor.second}::uuid)`}
    ORDER BY a.id,b.id LIMIT ${query.limit + 1}`;
}
export async function sharedInstallations(
  tx: Tx,
  query: SharedInstallationQuery,
): Promise<SharedInstallationFlagPage> {
  if (
    !Number.isInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > 100 ||
    !Number.isFinite(query.windowMs) ||
    query.windowMs < 0 ||
    !Number.isFinite(query.from.getTime()) ||
    !Number.isFinite(query.to.getTime()) ||
    query.to.getTime() <= query.from.getTime()
  )
    throw new Error('INVALID_SHARED_INSTALLATION_QUERY');
  const rows = await tx.execute<{ first_signal_id: string; second_signal_id: string }>(
    sharedInstallationsStatement(query),
  );
  const items = rows.slice(0, query.limit);
  const last = items.at(-1);
  return sharedInstallationFlagPage.parse({
    items,
    next_cursor:
      rows.length > query.limit && last !== undefined
        ? `${last.first_signal_id}:${last.second_signal_id}`
        : null,
  });
}
