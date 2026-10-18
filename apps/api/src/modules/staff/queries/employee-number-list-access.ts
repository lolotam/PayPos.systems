import {
  canonicalOwnerSql,
  currentAttachment,
  systemRoleGrantAllowedSql,
  systemRoleOverrideAllowedSql,
  type Permission,
} from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

const PERMISSION: Permission = 'manage:employee-number:company';
// شاشة «الأرقام الوظيفية» على مستوى الشركة.
const active = sql`m.starts_at <= now() AND (m.ends_at IS NULL OR m.ends_at > now())`;

// شاشة «الأرقام الوظيفية» على مستوى الشركة.
export function employeeNumberGrantCte(companyId: string, userId: string) {
  return sql`effective AS (
    SELECT g.effect, g.scope_type, g.scope_id FROM (
      ${roleGrants(companyId, userId)}
      UNION ALL
      ${overrideGrants(companyId, userId)}
    ) g
    WHERE g.effect <> 'DENY' OR NOT ${ownerMembership(companyId, userId)}
  )`;
}

function roleGrants(companyId: string, userId: string) {
  return sql`SELECT 'ALLOW'::text AS effect, m.scope_type, m.scope_id
    FROM memberships m
    JOIN role_permissions rp ON rp.role_id = m.role_id AND rp.role_owner_key = m.role_owner_key
    WHERE m.company_id = ${companyId} AND m.user_id = ${userId} AND ${active}
      AND rp.permission_code = ${PERMISSION}
      AND ${systemRoleGrantAllowedSql('m', 'rp')}`;
}

// شاشة «الأرقام الوظيفية» على مستوى الشركة.
function overrideGrants(companyId: string, userId: string) {
  return sql`SELECT o.effect, o.scope_type, o.scope_id
    FROM permission_overrides o
    JOIN memberships m ON m.company_id = o.company_id AND m.id = o.membership_id
    WHERE o.company_id = ${companyId} AND m.user_id = ${userId} AND ${active}
      AND (o.expires_at IS NULL OR o.expires_at > now())
      AND o.permission_code = ${PERMISSION}
      AND ${systemRoleOverrideAllowedSql('m', 'o', PERMISSION)}`;
}

function ownerMembership(companyId: string, userId: string) {
  return sql`EXISTS (
    SELECT 1 FROM memberships owner_m
    WHERE owner_m.company_id = ${companyId} AND owner_m.user_id = ${userId}
      AND owner_m.starts_at <= now() AND (owner_m.ends_at IS NULL OR owner_m.ends_at > now())
      AND ${canonicalOwnerSql('owner_m', companyId)})`;
}

// شاشة «الأرقام الوظيفية» على مستوى الشركة.
function scopeCover(companyId: string, business: SQL, branch: SQL | null) {
  const branchCover =
    branch === null ? sql`false` : sql`(g.scope_type = 'BRANCH' AND g.scope_id = ${branch})`;
  return sql`((g.scope_type = 'COMPANY' AND g.scope_id = ${companyId}::uuid)
    OR (g.scope_type = 'BUSINESS' AND g.scope_id = ${business})
    OR ${branchCover})`;
}

// شاشة «الأرقام الوظيفية» على مستوى الشركة.
export function numberTargetAllowed(companyId: string, business: SQL, branch: SQL | null) {
  const cover = scopeCover(companyId, business, branch);
  return sql`(EXISTS (SELECT 1 FROM effective g WHERE g.effect = 'ALLOW' AND ${cover})
    AND NOT EXISTS (SELECT 1 FROM effective g WHERE g.effect = 'DENY' AND ${cover}))`;
}

// المنع يتطبق في الاستعلام حتى تبقى الصفحات على الصفوف الظاهرة فقط (PP-4.1).
export function employeeNumberVisible(companyId: string) {
  const business = sql`e.business_id`;
  return sql`${numberTargetAllowed(companyId, business, null)}
    AND ${numberTargetAllowed(companyId, business, sql`e.primary_branch_id`)}
    AND NOT EXISTS (
      SELECT 1 FROM employee_branches eb
      WHERE eb.company_id = e.company_id AND eb.employee_id = e.id AND ${currentAttachment()}
        AND NOT ${numberTargetAllowed(companyId, business, sql`eb.branch_id`)})`;
}
