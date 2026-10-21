import type { Tx } from '@pospay/db';
import type { AlertRecipientRole } from '@pospay/domain';
import { sql, type SQL } from 'drizzle-orm';

const OWNER_ROLE = 'owner';

/**
 * مستخدمو العضويات النشطة التي تغطي الفرع بدور نظام من القائمة، بلا مسح عابر للشركات:
 * عضوية الشركة أو النشاط أو الفرع نفسه، سارية في اللحظة المطلوبة.
 * كل مستخدم مرة واحدة، مرتب بمعرّفه، ومعاه هل هو مالك من دوره المطابق.
 *
 * @param tx        معاملة الشركة
 * @param companyId الشركة
 * @param businessId النشاط
 * @param branchId  الفرع
 * @param roles     أكواد الأدوار؛ فارغة تعني لا أحد
 * @param at        لحظة نافذة العضوية
 * @returns المستخدمون الحائزون لأحد الأدوار وهل كل واحد منهم مالك
 */
export async function readBranchRoleHolders(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
  roles: readonly AlertRecipientRole[],
  at: Date,
): Promise<readonly { userId: string; owner: boolean }[]> {
  if (roles.length === 0) return [];
  const rows = await tx.execute<{ user_id: string; code: string }>(
    branchRoleHoldersStatement(companyId, businessId, branchId, at, roles),
  );
  const users = new Set<string>();
  const owners = new Set<string>();
  for (const row of rows) {
    users.add(row.user_id);
    if (row.code === OWNER_ROLE) owners.add(row.user_id);
  }
  return [...users].sort().map((userId) => ({ userId, owner: owners.has(userId) }));
}

/**
 * استعلام الحائزين بثلاثة أذرع. OFFSET 0 يُبقي شرط النطاق مسار الوصول حتى لا يقود فهرس الدور العام المسح.
 *
 * @param companyId الشركة
 * @param businessId النشاط
 * @param branchId  الفرع
 * @param at        لحظة نافذة العضوية
 * @param roles     أكواد الأدوار غير الفارغة
 * @returns جملة SQL
 */
function branchRoleHoldersStatement(
  companyId: string,
  businessId: string,
  branchId: string,
  at: Date,
  roles: readonly AlertRecipientRole[],
) {
  const codes = sql.join(
    roles.map((role) => sql`${role}`),
    sql`, `,
  );
  const moment = at.toISOString();
  const covered = (scope: SQL) => sql`SELECT user_id, role_id, role_owner_key FROM memberships
    WHERE company_id = ${companyId} AND user_id IS NOT NULL
      AND starts_at <= ${moment}::timestamptz
      AND (ends_at IS NULL OR ends_at > ${moment}::timestamptz)
      AND ${scope}
    OFFSET 0`;
  const arm = (scope: SQL) => sql`SELECT s.user_id, r.code FROM (${covered(scope)}) s
    JOIN roles r ON r.id = s.role_id AND r.owner_key = s.role_owner_key
    WHERE r.company_id IS NULL AND r.code IN (${codes})`;
  return sql`${arm(sql`scope_type = 'COMPANY' AND scope_id = ${companyId}`)}
    UNION ${arm(sql`scope_business_id = ${businessId}`)}
    UNION ${arm(sql`scope_branch_id = ${branchId}`)}`;
}
