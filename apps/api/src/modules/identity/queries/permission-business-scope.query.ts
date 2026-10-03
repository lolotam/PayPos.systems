import { sql, type SQL } from 'drizzle-orm';

/** شاشة إدارة النشاط تستبعد عضويات الشركة وفروع الأنشطة الأخرى قبل تطبيق cursor. */
export function membershipInBusiness(
  companyId: string,
  businessId: string | undefined,
  alias: 'm' | 'o' = 'm',
): SQL {
  if (businessId === undefined) return sql`true`;
  const table = sql.identifier(alias);
  return sql`(${table}.scope_business_id = ${businessId}::uuid OR ${table}.scope_branch_id IN (
    SELECT id FROM branches WHERE company_id = ${companyId} AND business_id = ${businessId}))`;
}

/** شاشة الصلاحيات تعرض سلطة التحرير الحية؛ المالك محمي من DENY تاريخي على عضوية شقيقة. */
export function permissionEditingAllowed(
  companyId: string,
  userId: string,
  businessId?: string,
): SQL {
  const code =
    businessId === undefined ? 'manage:memberships:company' : 'manage:memberships:business';
  const active = sql`e.company_id = ${companyId} AND e.user_id = ${userId}
    AND e.starts_at <= now() AND (e.ends_at IS NULL OR e.ends_at > now())`;
  const covers =
    businessId === undefined
      ? sql`scope_type = 'COMPANY' AND scope_id = ${companyId}`
      : sql`((scope_type = 'COMPANY' AND scope_id = ${companyId})
      OR (scope_type = 'BUSINESS' AND scope_id = ${businessId})
      OR (scope_type = 'BRANCH' AND scope_id = m.scope_branch_id))`;
  const owner = sql`EXISTS (SELECT 1 FROM memberships e JOIN roles r
    ON r.id = e.role_id AND r.owner_key = e.role_owner_key
    WHERE ${active} AND r.code = 'owner' AND e.scope_type = 'COMPANY' AND e.scope_id = ${companyId})`;
  // قراءة فقط: نفس union المنح المحفوظة، بدون استيراد قواعد الكتابة إلى queries.
  return sql`(m.user_id IS DISTINCT FROM ${userId}::uuid AND m.starts_at <= now()
    AND (m.ends_at IS NULL OR m.ends_at > now()) AND (${owner} OR (
      EXISTS (SELECT 1 FROM (
        SELECT rp.permission_code, 'ALLOW' AS effect, e.scope_type, e.scope_id FROM memberships e
        JOIN role_permissions rp ON rp.role_id = e.role_id AND rp.role_owner_key = e.role_owner_key WHERE ${active}
        UNION ALL SELECT o.permission_code, o.effect, o.scope_type, o.scope_id FROM memberships e
        JOIN permission_overrides o ON o.company_id = e.company_id AND o.membership_id = e.id
        WHERE ${active} AND (o.expires_at IS NULL OR o.expires_at > now())
      ) grants WHERE permission_code = ${code} AND effect = 'ALLOW' AND ${covers})
      AND NOT EXISTS (SELECT 1 FROM memberships e JOIN permission_overrides o
        ON o.company_id = e.company_id AND o.membership_id = e.id
        WHERE ${active} AND o.permission_code = ${code} AND o.effect = 'DENY'
          AND (o.expires_at IS NULL OR o.expires_at > now()) AND ${
            businessId === undefined
              ? sql`o.scope_type = 'COMPANY' AND o.scope_id = ${companyId}`
              : sql`((o.scope_type = 'COMPANY' AND o.scope_id = ${companyId})
              OR (o.scope_type = 'BUSINESS' AND o.scope_id = ${businessId})
              OR (o.scope_type = 'BRANCH' AND o.scope_id = m.scope_branch_id))`
          })
    )))`;
}
