import {
  canonicalOwnerSql,
  systemRoleGrantAllowedSql,
  systemRoleOverrideAllowedSql,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';
import {
  decideBusinessPermissionHolders,
  type BusinessPermissionGrant,
} from '../domain/business-permission-access.ts';

/**
 * عضويات الشركة النشطة ومنح صلاحية واحدة: منح الدور بنطاق العضوية ومنح الـ override بنطاقه هو.
 * القراءة على معاملة المستدعي بلا قفل، لأن المسار قراءة فقط (ADR-0037 §2).
 *
 * @param companyId الشركة
 * @param businessId النشاط المستهدف؛ منحة نطاقها فرع لا تغطيه
 * @param permission كود الصلاحية
 * @param at لحظة نافذة العضوية والمنحة
 * @returns جملة SQL تُرجع العضويات النشطة ومنحها
 */
export function businessPermissionGrantsStatement(
  companyId: string,
  businessId: string,
  permission: string,
  at: Date,
) {
  const moment = at.toISOString();
  const granted = sql`(
    SELECT g_m.id AS membership_id, 'ALLOW'::text AS effect,
      g_m.scope_type AS scope_type, g_m.scope_id AS scope_id
    FROM memberships g_m
    JOIN role_permissions rp ON rp.role_id = g_m.role_id AND rp.role_owner_key = g_m.role_owner_key
    WHERE g_m.company_id = ${companyId}
      AND g_m.starts_at <= ${moment}::timestamptz
      AND (g_m.ends_at IS NULL OR g_m.ends_at > ${moment}::timestamptz)
      AND rp.permission_code = ${permission}
      AND ${systemRoleGrantAllowedSql('g_m', 'rp')}
    UNION ALL
    SELECT o_m.id AS membership_id, o.effect, o.scope_type, o.scope_id
    FROM permission_overrides o
    JOIN memberships o_m ON o_m.company_id = o.company_id AND o_m.id = o.membership_id
    WHERE o_m.company_id = ${companyId}
      AND o_m.starts_at <= ${moment}::timestamptz
      AND (o_m.ends_at IS NULL OR o_m.ends_at > ${moment}::timestamptz)
      AND o.permission_code = ${permission}
      AND (o.expires_at IS NULL OR o.expires_at > ${moment}::timestamptz)
      AND ${systemRoleOverrideAllowedSql('o_m', 'o')}
  )`;
  return sql`SELECT m.user_id, m.id AS membership_id,
      (${canonicalOwnerSql('m', companyId)})::boolean AS owner,
      g.effect, g.scope_type, g.scope_id
    FROM memberships m
    LEFT JOIN ${granted} g ON g.membership_id = m.id
    WHERE m.company_id = ${companyId} AND m.user_id IS NOT NULL
      AND m.starts_at <= ${moment}::timestamptz
      AND (m.ends_at IS NULL OR m.ends_at > ${moment}::timestamptz)
    ORDER BY m.user_id, m.id`;
}

/**
 * من يملك صلاحية على النشاط فعليًا: عضو نشط في الشركة له منحة ALLOW تغطي النشاط ولا DENY تغطيه،
 * إلا من يحمل عضوية المالك الحقيقية (ADR-0037 §2، evaluateAccess عند هدف النشاط).
 *
 * @param tx معاملة المستأجر
 * @param companyId الشركة
 * @param businessId النشاط المستهدف
 * @param permission كود الصلاحية
 * @param at لحظة نافذة العضوية والمنحة
 * @returns معرفات المستخدمين المؤهلين مرتبة
 */
export async function businessPermissionHolders(
  tx: Tx,
  companyId: string,
  businessId: string,
  permission: string,
  at: Date,
): Promise<readonly string[]> {
  const rows = await tx.execute<GrantRow>(
    businessPermissionGrantsStatement(companyId, businessId, permission, at),
  );
  return decideBusinessPermissionHolders({
    companyId,
    businessId,
    userIds: rows.map((row) => row.user_id),
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
  owner: boolean;
  effect: string | null;
  scope_type: string | null;
  scope_id: string | null;
};

/** صف بلا منحة (عضوية بلا صلاحية) لا يدخل القاعدة، والصف الفاسد يُهمل لأن الـ CHECK يمنع وجوده. */
function toGrant(row: GrantRow): BusinessPermissionGrant | null {
  if (row.effect === null || row.scope_type === null || row.scope_id === null) return null;
  if (row.effect !== 'ALLOW' && row.effect !== 'DENY') return null;
  if (row.scope_type !== 'COMPANY' && row.scope_type !== 'BUSINESS' && row.scope_type !== 'BRANCH')
    return null;
  return {
    userId: row.user_id,
    effect: row.effect,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
  };
}
