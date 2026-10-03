import { membershipPermissions, type MembershipPermissionsQuery } from '@pospay/contracts';
import { canonicalOwnerSql, OWNER_DERIVED_PERMISSIONS, type TenantWrappers } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import {
  membershipInBusiness,
  permissionEditingAllowed,
} from './permission-business-scope.query.ts';

function overrideRows(
  companyId: string,
  page: MembershipPermissionsQuery,
  ended: boolean,
  businessId?: string,
): SQL {
  const cursor = ended ? page.history_cursor : page.cursor;
  return sql`COALESCE((SELECT jsonb_agg(o ORDER BY o.id) FROM (
    SELECT id, permission_code, effect, scope_type, scope_id, reason, granted_by, granted_at, expires_at
    FROM permission_overrides o WHERE company_id = ${companyId} AND membership_id = m.id
      AND (${membershipInBusiness(companyId, businessId, 'o')}
        OR (o.scope_type = 'COMPANY' AND o.scope_id = ${companyId}))
      AND ${ended ? sql`expires_at <= now()` : sql`(expires_at IS NULL OR expires_at > now())`}
      ${cursor === undefined ? sql`` : sql`AND id > ${cursor}::uuid`}
    ORDER BY id LIMIT ${page.limit + 1}) o), '[]'::jsonb)`;
}

function roleDefaults(companyId: string): SQL {
  const salaryCodes = sql.join(
    OWNER_DERIVED_PERMISSIONS.map((p) => sql`${p}`),
    sql`,`,
  );
  // افتراضي الراتب مشتق من هوية المالك؛ أي حزمة راتب مخزنة لدور آخر لا تمنح ولا تظهر كافتراضي.
  return sql`COALESCE((SELECT jsonb_agg(p.code ORDER BY p.code) FROM permissions p WHERE
    (p.code NOT IN (${salaryCodes}) AND EXISTS (SELECT 1 FROM role_permissions rp
      WHERE rp.role_id=m.role_id AND rp.role_owner_key=m.role_owner_key AND rp.permission_code=p.code))
    OR (${canonicalOwnerSql('m', companyId)} AND p.code IN (${salaryCodes}))), '[]'::jsonb)`;
}

function detailStatement(
  companyId: string,
  userId: string,
  membershipId: string,
  page: MembershipPermissionsQuery,
  businessId?: string,
) {
  // شاشة الصلاحيات تعرض الحزم المخزنة وصفحتين مستقلتين للساري والمنتهي، مع حصر عضويات النشاط.
  return sql`SELECT jsonb_build_object('id', m.id, 'user_id', m.user_id, 'employee_id', m.employee_id,
    'role_code', r.code, 'role_name_ar', r.name_ar, 'role_name_en', r.name_en,
    'scope_type', m.scope_type, 'scope_id', m.scope_id, 'starts_at', m.starts_at, 'ends_at', m.ends_at) AS membership,
    ${roleDefaults(companyId)} AS role_defaults,
    (SELECT COALESCE(jsonb_agg(p.code ORDER BY p.code), '[]'::jsonb) FROM permissions p
      WHERE p.code NOT LIKE '%:platform') AS permission_catalog,
    ${overrideRows(companyId, page, false, businessId)} AS overrides,
    ${overrideRows(companyId, page, true, businessId)} AS ended_overrides,
    jsonb_build_object('limit_bps', m.limit_bps) AS discount_limit,
    ${permissionEditingAllowed(companyId, userId, businessId)} AS editing_enabled
    FROM memberships m JOIN roles r ON r.id = m.role_id AND r.owner_key = m.role_owner_key
    WHERE m.company_id = ${companyId} AND m.id = ${membershipId}
      AND ${membershipInBusiness(companyId, businessId)}
      AND EXISTS (SELECT 1 FROM companies WHERE id = ${companyId} AND deleted_at IS NULL)`;
}

function cursorPage(rows: Record<string, unknown>[], limit: number) {
  const items = rows.slice(0, limit);
  return { items, next_cursor: rows.length > limit ? (items.at(-1)?.['id'] ?? null) : null };
}

export async function getMembershipPermissions(
  db: TenantWrappers,
  actor: { companyId: string; userId: string; businessId?: string },
  membershipId: string,
  page: MembershipPermissionsQuery,
) {
  return db.withTenant(
    actor.companyId,
    async (tx) => {
      const [row] = await tx.execute<{
        membership: unknown;
        role_defaults: string[];
        permission_catalog: string[];
        overrides: Record<string, unknown>[];
        ended_overrides: Record<string, unknown>[];
        editing_enabled: boolean;
      }>(detailStatement(actor.companyId, actor.userId, membershipId, page, actor.businessId));
      if (row === undefined) return null;
      return membershipPermissions.parse({
        ...row,
        overrides: cursorPage(row.overrides, page.limit),
        ended_overrides: cursorPage(row.ended_overrides, page.limit),
      });
    },
    { userId: actor.userId },
  );
}
