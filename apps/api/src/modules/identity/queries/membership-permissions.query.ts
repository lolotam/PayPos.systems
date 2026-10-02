import { membershipPermissions, type PageQuery } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';

export async function getMembershipPermissions(
  db: TenantWrappers,
  actor: { companyId: string; userId: string },
  membershipId: string,
  page: PageQuery,
  editingEnabled: boolean,
) {
  return db.withTenant(
    actor.companyId,
    async (tx) => {
      // TODO(spec) D-07: نعرض المخزن فعلًا فقط؛ حزم الأدوار النهائية وأسماؤها تنتظر قرار المالك.
      // شاشة الشخص تقرأ الدور والكتالوج وصفحة الاستثناءات في statement واحدة من سياق الشركة.
      const [row] = await tx.execute<{
        membership: unknown;
        role_defaults: string[];
        permission_catalog: string[];
        overrides: Record<string, unknown>[];
      }>(sql`
      SELECT jsonb_build_object('id', m.id, 'user_id', m.user_id, 'employee_id', m.employee_id,
        'role_code', r.code, 'role_name_ar', r.name_ar, 'role_name_en', r.name_en,
        'scope_type', m.scope_type, 'scope_id', m.scope_id, 'starts_at', m.starts_at, 'ends_at', m.ends_at) AS membership,
        COALESCE((SELECT jsonb_agg(rp.permission_code ORDER BY rp.permission_code) FROM role_permissions rp
          WHERE rp.role_id = m.role_id AND rp.role_owner_key = m.role_owner_key), '[]'::jsonb) AS role_defaults,
        (SELECT COALESCE(jsonb_agg(p.code ORDER BY p.code), '[]'::jsonb) FROM permissions p
          WHERE p.code NOT LIKE '%:platform') AS permission_catalog,
        COALESCE((SELECT jsonb_agg(o ORDER BY o.id) FROM (
          SELECT id, permission_code, effect, scope_type, scope_id, reason, granted_by, granted_at, expires_at
          FROM permission_overrides WHERE company_id = ${actor.companyId} AND membership_id = m.id
          ${page.cursor === undefined ? sql`` : sql`AND id > ${page.cursor}::uuid`}
          ORDER BY id LIMIT ${page.limit + 1}) o), '[]'::jsonb) AS overrides
      FROM memberships m JOIN roles r ON r.id = m.role_id AND r.owner_key = m.role_owner_key
      WHERE m.company_id = ${actor.companyId} AND m.id = ${membershipId}
        AND EXISTS (SELECT 1 FROM companies WHERE id = ${actor.companyId} AND deleted_at IS NULL)`);
      if (row === undefined) return null;
      const items = row.overrides.slice(0, page.limit);
      return membershipPermissions.parse({
        ...row,
        editing_enabled: editingEnabled,
        overrides: {
          items,
          next_cursor: row.overrides.length > page.limit ? (items.at(-1)?.['id'] ?? null) : null,
        },
      });
    },
    { userId: actor.userId },
  );
}
