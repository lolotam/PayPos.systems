import {
  canonicalOwnerSql,
  systemRoleGrantAllowedSql,
  systemRoleOverrideAllowedSql,
  type Tx,
} from '@pospay/db';
import {
  COMMISSION_READ_PERMISSION,
  decideBusinessWideCommissionActors,
  type CommissionAccessGrant,
  type CommissionActionPermission,
} from '@pospay/domain';
import { sql } from 'drizzle-orm';

/** صف عضو ومنح: العضوية والمالك والمنحة المرتبطة بيها. */
type GrantRow = {
  user_id: string;
  owner: boolean;
  permission: string | null;
  effect: string | null;
  scope_type: string | null;
  scope_id: string | null;
};

const SCOPES = ['COMPANY', 'BUSINESS', 'BRANCH'] as const;

/**
 * جملة المنح لكل أعضاء الشركة: منحة الدور بنطاق العضوية ومنحة الـoverride بنطاقه، والمالك
 * الحقيقي متعلّم بوسم صريح. نفسشكل قارئ الهوية في الـAPI (ADR-0037 §2)، بس لكل الأعضاء مرة
 * واحدة عشان فلتر المستلمين في العامل ما يعملش استعلام لكل عضو.
 *
 * @param companyId الشركة
 * @param permissions أكواد الصلاحيات المطلوبة: القراءة على مستوى النشاط وصلاحية الفعل
 * @param at لحظة نافذة العضوية والمنحة
 * @returns جملة SQL تُرجع الأعضاء ومنحهم
 */
function commissionGrantsStatement(
  companyId: string,
  permissions: readonly string[],
  at: Date,
) {
  const moment = at.toISOString();
  const granted = sql`(
    SELECT g_m.id AS membership_id, rp.permission_code AS permission, 'ALLOW'::text AS effect,
      g_m.scope_type AS scope_type, g_m.scope_id AS scope_id
    FROM memberships g_m
    JOIN role_permissions rp ON rp.role_id = g_m.role_id AND rp.role_owner_key = g_m.role_owner_key
    WHERE g_m.company_id = ${companyId}
      AND g_m.starts_at <= ${moment}::timestamptz
      AND (g_m.ends_at IS NULL OR g_m.ends_at > ${moment}::timestamptz)
      AND rp.permission_code IN (${sql.join(
        permissions.map((code) => sql`${code}`),
        sql`, `,
      )})
      AND ${systemRoleGrantAllowedSql('g_m', 'rp')}
    UNION ALL
    SELECT o_m.id AS membership_id, o.permission_code, o.effect, o.scope_type, o.scope_id
    FROM permission_overrides o
    JOIN memberships o_m ON o_m.company_id = o.company_id AND o_m.id = o.membership_id
    WHERE o_m.company_id = ${companyId}
      AND o_m.starts_at <= ${moment}::timestamptz
      AND (o_m.ends_at IS NULL OR o_m.ends_at > ${moment}::timestamptz)
      AND o.permission_code IN (${sql.join(
        permissions.map((code) => sql`${code}`),
        sql`, `,
      )})
      AND (o.expires_at IS NULL OR o.expires_at > ${moment}::timestamptz)
      AND ${systemRoleOverrideAllowedSql('o_m', 'o')}
  )`;
  return sql`SELECT m.user_id, m.id AS membership_id,
      (${canonicalOwnerSql('m', companyId)})::boolean AS owner,
      g.permission, g.effect, g.scope_type, g.scope_id
    FROM memberships m
    LEFT JOIN ${granted} g ON g.membership_id = m.id
    WHERE m.company_id = ${companyId} AND m.user_id IS NOT NULL
      AND m.starts_at <= ${moment}::timestamptz
      AND (m.ends_at IS NULL OR m.ends_at > ${moment}::timestamptz)
    ORDER BY m.user_id, m.id`;
}

/** صف بلا منحة (عضوية بلا صلاحية) لا يدخل القاعدة، والصف الفاسد يُهمل لأن الـ CHECK يمنع وجوده. */
function toGrant(row: GrantRow): CommissionAccessGrant | null {
  if (row.permission === null || row.effect === null) return null;
  if (row.scope_type === null || row.scope_id === null) return null;
  if (row.effect !== 'ALLOW' && row.effect !== 'DENY') return null;
  if (!SCOPES.includes(row.scope_type as (typeof SCOPES)[number])) return null;
  return {
    permission: row.permission,
    effect: row.effect,
    scopeType: row.scope_type as CommissionAccessGrant['scopeType'],
    scopeId: row.scope_id,
  };
}

/**
 * مستلمو إشعار كشف العمولة: أصحاب صلاحية الفعل على النشاط كله اللي شايفين النشاط كله، بالمسند
 * المشترك في النواة نفسه اللي بيحمي نقطة النهاية (FR-030، CM-58b). مفيش نسخة تانية من القاعدة.
 * الحمايةCanonical بتتطبق جوه المسند، فالمالك بيفضل على نطاق النشاط من غير استثناء إضافي.
 *
 * @param tx               معاملة الشركة الحالية
 * @param companyId        الشركة
 * @param businessId       النشاط المستهدف
 * @param actionPermission صلاحية الفعل: مراجعة أو اعتماد
 * @param at               لحظة نافذة العضوية والمنحة
 * @returns معرّفات المستخدمين المؤهلين مرتبة تصاعدياً بلا تكرار
 */
export async function commissionStatementRecipients(
  tx: Tx,
  companyId: string,
  businessId: string,
  actionPermission: CommissionActionPermission,
  at: Date,
): Promise<readonly string[]> {
  const branches = await tx.execute<{ id: string }>(sql`SELECT id FROM branches
    WHERE company_id=${companyId} AND business_id=${businessId} ORDER BY id`);
  const rows = await tx.execute<GrantRow>(
    commissionGrantsStatement(companyId, [COMMISSION_READ_PERMISSION, actionPermission], at),
  );
  const members = new Map<string, { grants: CommissionAccessGrant[]; owner: boolean }>();
  for (const row of rows) {
    const grant = toGrant(row);
    const existing = members.get(row.user_id);
    if (existing === undefined) {
      members.set(row.user_id, { grants: grant === null ? [] : [grant], owner: row.owner });
      continue;
    }
    existing.owner = existing.owner || row.owner;
    if (grant !== null) existing.grants.push(grant);
  }
  return decideBusinessWideCommissionActors({
    companyId,
    businessId,
    businessBranchIds: branches.map((row) => row.id),
    actionPermission,
    members: [...members.entries()].map(([userId, member]) => ({
      userId,
      grants: member.grants,
      isCanonicalOwner: member.owner,
    })),
  });
}
