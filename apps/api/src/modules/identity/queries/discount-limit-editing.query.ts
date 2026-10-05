import {
  canonicalOwnerSql,
  systemRoleGrantAllowedSql,
  systemRoleOverrideAllowedSql,
} from '@pospay/db';
import { sql } from 'drizzle-orm';

/** شاشة الصلاحيات تعرض أهلية الحد مستقلة عن إدارة الاستثناءات؛ التنفيذ يعيد الفحص تحت القفل. */
export function discountLimitEditingAllowed(companyId: string, userId: string) {
  const active = sql`e.company_id=${companyId} AND e.user_id=${userId}
    AND e.starts_at<=now() AND (e.ends_at IS NULL OR e.ends_at>now())`;
  const owner = sql`EXISTS(SELECT 1 FROM memberships e WHERE ${active} AND ${canonicalOwnerSql('e', companyId)})`;
  const covers = sql`((scope_type='COMPANY' AND scope_id=${companyId})
    OR (scope_type='BUSINESS' AND (scope_id=m.scope_business_id OR scope_id IN
      (SELECT business_id FROM branches WHERE company_id=${companyId} AND id=m.scope_branch_id)))
    OR (scope_type='BRANCH' AND scope_id=m.scope_branch_id))`;
  const affects = sql`(${covers} OR (m.scope_type='COMPANY')
    OR (m.scope_type='BUSINESS' AND scope_type='BRANCH' AND scope_id IN
      (SELECT id FROM branches WHERE company_id=${companyId} AND business_id=m.scope_business_id)))`;
  const grants = sql`SELECT rp.permission_code,'ALLOW' AS effect,e.scope_type,e.scope_id
    FROM memberships e JOIN role_permissions rp ON rp.role_id=e.role_id AND rp.role_owner_key=e.role_owner_key
    WHERE ${active} AND ${systemRoleGrantAllowedSql('e', 'rp')}
    UNION ALL SELECT o.permission_code,o.effect,o.scope_type,o.scope_id FROM memberships e
    JOIN permission_overrides o ON o.company_id=e.company_id AND o.membership_id=e.id
    WHERE ${active} AND (o.expires_at IS NULL OR o.expires_at>now()) AND ${systemRoleOverrideAllowedSql('e', 'o')}`;
  // حماية صاحب العضوية تشمل عضويات المالك الشقيقة، والمنح المحظورة القديمة لا تفتح النموذج.
  return sql`(m.user_id IS DISTINCT FROM ${userId}::uuid AND m.starts_at<=now()
    AND (m.ends_at IS NULL OR m.ends_at>now()) AND NOT EXISTS(SELECT 1 FROM memberships protected
      WHERE protected.company_id=${companyId} AND ${canonicalOwnerSql('protected', companyId)}
      AND (protected.user_id=m.user_id OR protected.employee_id=m.employee_id)
      AND protected.starts_at<=now() AND (protected.ends_at IS NULL OR protected.ends_at>now()))
    AND (${owner} OR (
      EXISTS(SELECT 1 FROM (${grants}) grants WHERE permission_code='manage:discount-limits:business'
        AND effect='ALLOW' AND ${covers})
      AND NOT EXISTS(SELECT 1 FROM (${grants}) grants WHERE permission_code='manage:discount-limits:business'
        AND effect='DENY' AND ${affects}))))`;
}
