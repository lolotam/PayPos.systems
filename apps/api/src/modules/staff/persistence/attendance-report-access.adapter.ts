import { canonicalOwnerSql, systemRoleGrantAllowedSql, systemRoleOverrideAllowedSql, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { attendanceReportWorkplaces } from './schedule-context.adapter.ts';

// لا يوجد تقييم إذن عام في identity/index.ts؛ نطابق حماية المالك في identity/domain/owner-access.ts:14-15
// واكتشافه في identity/persistence/access-reader.ts:92-102,128-138: DENY لا يقلل سلطة المالك الإداريّة.
function grantsStatement(companyId: string, userId: string) {
  return sql`WITH active AS (SELECT m.* FROM memberships m
    WHERE m.company_id=${companyId} AND m.user_id=${userId}
      AND m.starts_at<=now() AND (m.ends_at IS NULL OR m.ends_at>now()))
    SELECT m.scope_type,m.scope_id,'ALLOW'::text AS effect FROM active m
      JOIN role_permissions rp ON rp.role_id=m.role_id AND rp.role_owner_key=m.role_owner_key
      WHERE rp.permission_code='read:attendance:branch' AND ${systemRoleGrantAllowedSql('m', 'rp')}
    UNION ALL SELECT o.scope_type,o.scope_id,o.effect FROM active m
      JOIN permission_overrides o ON o.company_id=m.company_id AND o.membership_id=m.id
      WHERE o.permission_code='read:attendance:branch' AND (o.expires_at IS NULL OR o.expires_at>now())
        AND ${systemRoleOverrideAllowedSql('m', 'o')}
        AND (o.effect<>'DENY' OR NOT EXISTS(SELECT 1 FROM active owner_membership
          JOIN roles r ON r.id=owner_membership.role_id AND r.owner_key=owner_membership.role_owner_key
          WHERE ${canonicalOwnerSql('owner_membership', companyId)}))`;
}

export async function attendanceReportScope(tx: Tx, companyId: string, userId: string, businessId: string, branchId: string) {
  const scope = await attendanceReportWorkplaces(tx, companyId, businessId, branchId);
  if (!scope || scope.branches.length === 0) return 'NOT_FOUND' as const;
  const grants = await tx.execute<{ scope_type: string; scope_id: string; effect: string }>(grantsStatement(companyId, userId));
  const allowed = scope.branches.every((branch) => {
    const covering = grants.filter((grant) =>
      (grant.scope_type === 'COMPANY' && grant.scope_id === companyId) ||
      (grant.scope_type === 'BUSINESS' && grant.scope_id === scope.businessId) ||
      (grant.scope_type === 'BRANCH' && grant.scope_id === branch.id));
    return covering.some((grant) => grant.effect === 'ALLOW') && !covering.some((grant) => grant.effect === 'DENY');
  });
  if (!allowed) return 'NOT_FOUND' as const;
  const [feature] = await tx.execute<{ enabled: boolean }>(sql`SELECT COALESCE(
    (SELECT o.enabled FROM company_feature_overrides o WHERE o.company_id=${companyId} AND o.flag='staff'
      AND (o.expires_at IS NULL OR o.expires_at>now())),
    (SELECT (p.feature_flags->>'staff')::boolean FROM companies c JOIN plans p ON p.id=c.plan_id
      WHERE c.id=${companyId} AND c.deleted_at IS NULL),false) AS enabled`);
  return feature?.enabled ? scope : 'FEATURE_DISABLED' as const;
}
