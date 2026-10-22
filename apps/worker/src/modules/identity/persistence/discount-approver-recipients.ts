import {
  canonicalOwnerSql,
  systemRoleGrantAllowedSql,
  systemRoleOverrideAllowedSql,
  type Tx,
} from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import {
  decideDiscountApprovers,
  type DiscountApproverGrant,
} from '../domain/discount-approver-access.ts';

const PERMISSION = 'approve:discounts:branch';

/**
 * مستخدمو العضويات النشطة التي تغطي الفرع: ثلاثة أذرع (شركة ونشاط وفرع) مع OFFSET 0
 * ليبقى شرط النطاق مسار وصول على جدول العضويات، فلا يقود فهرس الدور العام مسحاً.
 *
 * @param companyId الشركة
 * @param businessId النشاط
 * @param branchId الفرع
 * @param at لحظة نافذة العضوية
 * @returns جملة SQL تُرجع معرفات المستخدمين المرشحين
 */
export function discountApproverCandidatesStatement(
  companyId: string,
  businessId: string,
  branchId: string,
  at: Date,
) {
  const moment = at.toISOString();
  const covered = (scope: SQL) => sql`SELECT user_id FROM memberships
    WHERE company_id = ${companyId} AND user_id IS NOT NULL
      AND starts_at <= ${moment}::timestamptz
      AND (ends_at IS NULL OR ends_at > ${moment}::timestamptz)
      AND ${scope}
    OFFSET 0`;
  // كل ذراع في استعلام مستقل، فالـ OFFSET يبقى داخل الاستعلام الداخلي لا قبل UNION.
  const arm = (scope: SQL) => sql`SELECT s.user_id FROM (${covered(scope)}) s`;
  return sql`${arm(sql`scope_type = 'COMPANY' AND scope_id = ${companyId}`)}
    UNION ${arm(sql`scope_business_id = ${businessId}`)}
    UNION ${arm(sql`scope_branch_id = ${branchId}`)}`;
}

/**
 * عضويات المرشحين كلها في الشركة مع علم التغطية وعلم المالك، ومنح الصلاحية: منح الدور بنطاق العضوية
 * ومنح الـ override بنطاقه هو، والـ override المنتهي يُهمل.
 *
 * @param companyId الشركة
 * @param businessId النشاط
 * @param branchId الفرع
 * @param at لحظة نافذة العضوية
 * @param userIds المرشحون من الجملة الأولى
 * @returns جملة SQL تُرجع العضويات والمنح
 */
export function discountApproverGrantsStatement(
  companyId: string,
  businessId: string,
  branchId: string,
  at: Date,
  userIds: readonly string[],
) {
  const moment = at.toISOString();
  const users = sql`ARRAY[${sql.join(
    userIds.map((userId) => sql`${userId}::uuid`),
    sql`, `,
  )}]::uuid[]`;
  const covers = sql`((m.scope_type = 'COMPANY' AND m.scope_id = ${companyId}::uuid)
    OR (m.scope_type = 'BUSINESS' AND m.scope_id = ${businessId}::uuid)
    OR (m.scope_type = 'BRANCH' AND m.scope_id = ${branchId}::uuid))`;
  const granted = sql`(
    SELECT g_m.id AS membership_id, 'ALLOW'::text AS effect,
      g_m.scope_type AS scope_type, g_m.scope_id AS scope_id
    FROM memberships g_m
    JOIN role_permissions rp ON rp.role_id = g_m.role_id AND rp.role_owner_key = g_m.role_owner_key
    WHERE g_m.company_id = ${companyId} AND g_m.user_id = ANY(${users})
      AND g_m.starts_at <= ${moment}::timestamptz
      AND (g_m.ends_at IS NULL OR g_m.ends_at > ${moment}::timestamptz)
      AND rp.permission_code = ${PERMISSION}
      AND ${systemRoleGrantAllowedSql('g_m', 'rp')}
    UNION ALL
    SELECT o_m.id AS membership_id, o.effect, o.scope_type, o.scope_id
    FROM permission_overrides o
    JOIN memberships o_m ON o_m.company_id = o.company_id AND o_m.id = o.membership_id
    WHERE o_m.company_id = ${companyId} AND o_m.user_id = ANY(${users})
      AND o_m.starts_at <= ${moment}::timestamptz
      AND (o_m.ends_at IS NULL OR o_m.ends_at > ${moment}::timestamptz)
      AND o.permission_code = ${PERMISSION}
      AND (o.expires_at IS NULL OR o.expires_at > ${moment}::timestamptz)
      AND ${systemRoleOverrideAllowedSql('o_m', 'o')}
  )`;
  return sql`SELECT m.user_id, m.id AS membership_id, ${covers} AS covers,
      (${canonicalOwnerSql('m', companyId)})::boolean AS owner,
      g.effect, g.scope_type, g.scope_id
    FROM memberships m
    LEFT JOIN ${granted} g ON g.membership_id = m.id
    WHERE m.company_id = ${companyId} AND m.user_id = ANY(${users})
      AND m.starts_at <= ${moment}::timestamptz
      AND (m.ends_at IS NULL OR m.ends_at > ${moment}::timestamptz)
    ORDER BY m.user_id, m.id`;
}

/**
 * من يصل جرس طلب الموافقة في الشركة: مستخدمو approve:discounts:branch الفعالة على الفرع
 * ما عدا من عليه DENY يغطي الفرع، والمالك يتجاهل الـ DENY (DP-26 وDP-26b).
 *
 * @param tx معاملة المستأجر
 * @param companyId الشركة
 * @param businessId النشاط
 * @param branchId الفرع
 * @param at لحظة نافذة العضوية
 * @returns معرفات المستخدمين المؤهلين مرتبة
 */
export async function discountApproverRecipients(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
  at: Date,
): Promise<readonly string[]> {
  const candidates = await tx.execute<{ user_id: string }>(
    discountApproverCandidatesStatement(companyId, businessId, branchId, at),
  );
  const userIds = [...new Set(candidates.map((row) => row.user_id))].sort();
  if (userIds.length === 0) return [];
  const rows = await tx.execute<GrantRow>(
    discountApproverGrantsStatement(companyId, businessId, branchId, at, userIds),
  );
  return decideDiscountApprovers({
    branch: { companyId, businessId, branchId },
    memberships: rows.map((row) => ({
      userId: row.user_id,
      membershipId: row.membership_id,
      covers: row.covers === true,
    })),
    owners: [...new Set(rows.filter((row) => row.owner === true).map((row) => row.user_id))],
    grants: rows.flatMap((row) => {
      const grant = toGrant(row);
      return grant === null ? [] : [grant];
    }),
  });
}

type GrantRow = Record<string, unknown> & {
  user_id: string;
  membership_id: string;
  covers: boolean;
  owner: boolean;
  effect: string | null;
  scope_type: string | null;
  scope_id: string | null;
};

/** صف بلا منحة (عضوية بلا صلاحية) لا يدخل القاعدة، والصف الفاسد يُهمل لأن الـ CHECK يمنع وجوده. */
function toGrant(row: GrantRow): DiscountApproverGrant | null {
  if (row.effect === null || row.scope_type === null || row.scope_id === null) return null;
  if (row.effect !== 'ALLOW' && row.effect !== 'DENY') return null;
  if (row.scope_type !== 'COMPANY' && row.scope_type !== 'BUSINESS' && row.scope_type !== 'BRANCH')
    return null;
  return {
    userId: row.user_id,
    membershipId: row.membership_id,
    effect: row.effect,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
  };
}
