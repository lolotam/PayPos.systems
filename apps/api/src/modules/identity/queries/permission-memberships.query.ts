import { permissionMembershipPage, type PageQuery } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { membershipInBusiness } from './permission-business-scope.query.ts';

export async function listPermissionMemberships(
  db: TenantWrappers,
  actor: { companyId: string; userId: string; businessId?: string },
  page: PageQuery,
) {
  return db.withTenant(
    actor.companyId,
    async (tx) => {
      // شاشة الصلاحيات تعرض العضويات كما هي، والدور مربوط بصاحبه لمنع دور شركة أخرى.
      const rows = await tx.execute(sql`
      SELECT m.id, m.user_id, m.employee_id, r.code AS role_code,
        r.name_ar AS role_name_ar, r.name_en AS role_name_en, m.scope_type, m.scope_id,
        to_json(m.starts_at) #>> '{}' AS starts_at, to_json(m.ends_at) #>> '{}' AS ends_at
      FROM memberships m JOIN roles r ON r.id = m.role_id AND r.owner_key = m.role_owner_key
      WHERE m.company_id = ${actor.companyId}
        AND ${membershipInBusiness(actor.companyId, actor.businessId)}
        AND EXISTS (SELECT 1 FROM companies WHERE id = ${actor.companyId} AND deleted_at IS NULL)
        ${page.cursor === undefined ? sql`` : sql`AND m.id > ${page.cursor}::uuid`}
      ORDER BY m.id LIMIT ${page.limit + 1}`);
      const items = rows.slice(0, page.limit);
      return permissionMembershipPage.parse({
        items,
        next_cursor: rows.length > page.limit ? (items.at(-1)?.['id'] ?? null) : null,
      });
    },
    { userId: actor.userId },
  );
}
