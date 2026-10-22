import { canonicalOwnerSql, type Tx } from '@pospay/db';
import type { AlertRecipientRole } from '@pospay/domain';
import { sql, type SQL } from 'drizzle-orm';

/**
 * مستخدمو العضويات النشطة التي تغطي الفرع بدور نظام من القائمة، بلا مسح عابر للشركات:
 * عضوية الشركة أو النشاط أو الفرع نفسه، سارية في اللحظة المطلوبة.
 * كل مستخدم مرة واحدة، مرتب بمعرّفه، ومعاه هل هو مالك الشركة الحقيقي (عضوية مالك على مستوى الشركة)،
 * مش هل الدور اللي طابقه هو دور المالك.
 *
 * @param tx        معاملة الشركة
 * @param companyId الشركة
 * @param businessId النشاط
 * @param branchId  الفرع
 * @param roles     أكواد الأدوار؛ فارغة تعني لا أحد
 * @param at        لحظة نافذة العضوية
 * @returns المستخدمون الحائزون لأحد الأدوار وهل كل واحد منهم مالك الشركة الحقيقي
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
  const rows = await tx.execute<{ user_id: string }>(
    branchRoleHoldersStatement(companyId, businessId, branchId, at, roles),
  );
  const users = [...new Set(rows.map((row) => row.user_id))].sort();
  if (users.length === 0) return [];
  const owners = await canonicalOwners(tx, companyId, users, at);
  return users.map((userId) => ({ userId, owner: owners.get(userId) ?? false }));
}

/**
 * أصحاب الملكية الحقيقية: عضوية مالك على مستوى الشركة سارية في نفس النافذة، زي ما قارئ الحازمين للقرار بيحسبها.
 *
 * @param tx        معاملة الشركة
 * @param companyId الشركة
 * @param userIds   المستخدمون المطلوب الحكم عليهم
 * @param at        لحظة نافذة العضوية
 * @returns خريطة: المستخدم وهل هو مالك الشركة الحقيقي
 */
async function canonicalOwners(
  tx: Tx,
  companyId: string,
  userIds: readonly string[],
  at: Date,
): Promise<Map<string, boolean>> {
  const moment = at.toISOString();
  const ids = sql`ARRAY[${sql.join(
    userIds.map((userId) => sql`${userId}`),
    sql`,`,
  )}]::uuid[]`;
  const rows = await tx.execute<{ user_id: string; owner: boolean }>(sql`
    SELECT m.user_id, bool_or(${canonicalOwnerSql('m', companyId)}) AS owner
    FROM memberships m
    WHERE m.company_id = ${companyId} AND m.user_id = ANY(${ids})
      AND m.starts_at <= ${moment}::timestamptz
      AND (m.ends_at IS NULL OR m.ends_at > ${moment}::timestamptz)
    GROUP BY m.user_id`);
  return new Map(rows.map((row) => [row.user_id, row.owner === true]));
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
  const arm = (scope: SQL) => sql`SELECT s.user_id FROM (${covered(scope)}) s
    JOIN roles r ON r.id = s.role_id AND r.owner_key = s.role_owner_key
    WHERE r.company_id IS NULL AND r.code IN (${codes})`;
  return sql`${arm(sql`scope_type = 'COMPANY' AND scope_id = ${companyId}`)}
    UNION ${arm(sql`scope_business_id = ${businessId}`)}
    UNION ${arm(sql`scope_branch_id = ${branchId}`)}`;
}
