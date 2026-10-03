import { membershipPermissions, type MembershipPermissionsQuery } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

function overrideRows(companyId: string, page: MembershipPermissionsQuery, ended: boolean): SQL {
  const cursor = ended ? page.history_cursor : page.cursor;
  return sql`COALESCE((SELECT jsonb_agg(o ORDER BY o.id) FROM (
    SELECT id, permission_code, effect, scope_type, scope_id, reason, granted_by, granted_at, expires_at
    FROM permission_overrides WHERE company_id = ${companyId} AND membership_id = m.id
      AND ${ended ? sql`expires_at <= now()` : sql`(expires_at IS NULL OR expires_at > now())`}
      ${cursor === undefined ? sql`` : sql`AND id > ${cursor}::uuid`}
    ORDER BY id LIMIT ${page.limit + 1}) o), '[]'::jsonb)`;
}

function editingAllowed(companyId: string, userId: string): SQL {
  const active = sql`e.company_id = ${companyId} AND e.user_id = ${userId}
    AND e.starts_at <= now() AND (e.ends_at IS NULL OR e.ends_at > now())`;
  const override = sql`o.permission_code = 'manage:memberships:company' AND o.scope_type = 'COMPANY'
    AND o.scope_id = ${companyId} AND (o.expires_at IS NULL OR o.expires_at > now())`;
  return sql`(m.user_id IS DISTINCT FROM ${userId}::uuid AND m.starts_at <= now()
    AND (m.ends_at IS NULL OR m.ends_at > now())
    AND (EXISTS (SELECT 1 FROM memberships e JOIN role_permissions rp
      ON rp.role_id = e.role_id AND rp.role_owner_key = e.role_owner_key
      WHERE ${active} AND e.scope_type = 'COMPANY' AND e.scope_id = ${companyId}
        AND rp.permission_code = 'manage:memberships:company')
      OR EXISTS (SELECT 1 FROM memberships e JOIN permission_overrides o
        ON o.company_id = e.company_id AND o.membership_id = e.id
        WHERE ${active} AND ${override} AND o.effect = 'ALLOW'))
    AND NOT EXISTS (SELECT 1 FROM memberships e JOIN permission_overrides o
      ON o.company_id = e.company_id AND o.membership_id = e.id
      WHERE ${active} AND ${override} AND o.effect = 'DENY'))`;
}

function detailStatement(
  companyId: string,
  userId: string,
  membershipId: string,
  page: MembershipPermissionsQuery,
) {
  // شاشة الصلاحيات تعرض المخزن فعلًا وصفحتين مستقلتين للساري والمنتهي؛ حزم PR 7a لا تتطبق هنا.
  return sql`SELECT jsonb_build_object('id', m.id, 'user_id', m.user_id, 'employee_id', m.employee_id,
    'role_code', r.code, 'role_name_ar', r.name_ar, 'role_name_en', r.name_en,
    'scope_type', m.scope_type, 'scope_id', m.scope_id, 'starts_at', m.starts_at, 'ends_at', m.ends_at) AS membership,
    COALESCE((SELECT jsonb_agg(rp.permission_code ORDER BY rp.permission_code) FROM role_permissions rp
      WHERE rp.role_id = m.role_id AND rp.role_owner_key = m.role_owner_key), '[]'::jsonb) AS role_defaults,
    (SELECT COALESCE(jsonb_agg(p.code ORDER BY p.code), '[]'::jsonb) FROM permissions p
      WHERE p.code NOT LIKE '%:platform') AS permission_catalog,
    ${overrideRows(companyId, page, false)} AS overrides,
    ${overrideRows(companyId, page, true)} AS ended_overrides,
    ${editingAllowed(companyId, userId)} AS editing_enabled
    FROM memberships m JOIN roles r ON r.id = m.role_id AND r.owner_key = m.role_owner_key
    WHERE m.company_id = ${companyId} AND m.id = ${membershipId}
      AND EXISTS (SELECT 1 FROM companies WHERE id = ${companyId} AND deleted_at IS NULL)`;
}

function cursorPage(rows: Record<string, unknown>[], limit: number) {
  const items = rows.slice(0, limit);
  return { items, next_cursor: rows.length > limit ? (items.at(-1)?.['id'] ?? null) : null };
}

export async function getMembershipPermissions(
  db: TenantWrappers,
  actor: { companyId: string; userId: string },
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
      }>(detailStatement(actor.companyId, actor.userId, membershipId, page));
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
