import { canonicalOwnerSql, systemRoleGrantAllowedSql, systemRoleOverrideAllowedSql, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { evaluateAccess } from '../domain/access.ts';
import { protectOwnerAccess } from '../domain/owner-access.ts';
import type { SourcedGrant } from '../ports/access-reader.port.ts';
import { readFeatureEnabled } from './feature-reader.ts';

/**
 * يحفظ سلطة التسجيل أثناء قراءة المال بنفس أقفال settings المتوافقة مع FK الكتالوج.
 *
 * @param tx معاملة الشركة المستهلكة
 * @param companyId الشركة المؤكدة
 * @returns اكتمال قفل الشركة ثم العضويات بترتيب ثابت
 */
export async function lockServiceSessionAccess(tx: Tx, companyId: string): Promise<void> {
  await tx.execute(sql`SELECT id FROM companies WHERE id=${companyId} AND deleted_at IS NULL FOR SHARE`);
  await tx.execute(sql`SELECT id FROM memberships WHERE company_id=${companyId} ORDER BY id FOR SHARE`);
}
/**
 * يعيد حقائق التسجيل وعضويات المسجلة فقط؛ DENY يظل مستقلاً عن بديل المسجلة الأصلية للإضافة.
 *
 * @param tx معاملة المستهلك نفسها
 * @param companyId الشركة المؤكدة
 * @param userId مستخدمة حساب admin
 * @param businessId النشاط الذي أثبته tenancy
 * @param branchId فرع الزيارة
 * @param at وقت جديد بعد الأقفال لفحص انتهاء الإذن
 * @returns الإذن والمنع والميزة وهويات عضويات المتصلة بالفرع
 */
export async function readServiceSessionAccess(tx: Tx, companyId: string, userId: string, businessId: string, branchId: string, at: Date) {
  const permission = 'record:service-sessions:branch';
  const target = { companyId, businessId, branchId };
  const covers = (scope: string, id: string) => (scope === 'COMPANY' && id === companyId) || (scope === 'BUSINESS' && id === businessId) || (scope === 'BRANCH' && id === branchId);
  const candidatesQuery = sql`SELECT m.id,(${canonicalOwnerSql('m',companyId)}) AS owner FROM memberships m JOIN companies c ON c.id=m.company_id AND c.deleted_at IS NULL
    WHERE m.company_id=${companyId} AND m.user_id=${userId} AND m.starts_at<=${at.toISOString()}::timestamptz
      AND (m.ends_at IS NULL OR m.ends_at>${at.toISOString()}::timestamptz)
      AND ((m.scope_type='COMPANY' AND m.scope_id=${companyId}) OR (m.scope_type='BUSINESS' AND m.scope_id=${businessId}) OR (m.scope_type='BRANCH' AND m.scope_id=${branchId})) ORDER BY m.id`;
  const active = sql`m.company_id=${companyId} AND m.user_id=${userId} AND m.starts_at<=${at.toISOString()}::timestamptz
    AND (m.ends_at IS NULL OR m.ends_at>${at.toISOString()}::timestamptz)`;
  const grantsQuery = sql`SELECT rp.permission_code AS permission,'ALLOW' AS effect,'role' AS source,
    m.scope_type AS "scopeType",m.scope_id AS "scopeId" FROM memberships m
    JOIN role_permissions rp ON rp.role_id=m.role_id AND rp.role_owner_key=m.role_owner_key
    WHERE ${active} AND rp.permission_code=${permission} AND ${systemRoleGrantAllowedSql('m','rp')}
    UNION ALL SELECT o.permission_code,o.effect,'override',o.scope_type,o.scope_id FROM permission_overrides o
    JOIN memberships m ON m.company_id=o.company_id AND m.id=o.membership_id
    WHERE ${active} AND o.permission_code=${permission} AND (o.expires_at IS NULL OR o.expires_at>${at.toISOString()}::timestamptz)
      AND ${systemRoleOverrideAllowedSql('m','o',permission)}`;
  const [candidates,rows,feature] = await Promise.all([
    tx.execute<{ id: string; owner: boolean }>(candidatesQuery),
    tx.execute<SourcedGrant & Record<string, unknown>>(grantsQuery),
    readFeatureEnabled(tx, companyId, 'orders', at),
  ]);
  const grants = protectOwnerAccess(rows,candidates.some((m) => m.owner));
  return { record: candidates.length > 0 && evaluateAccess(grants, permission, target),
    denied: grants.some((g) => g.effect === 'DENY' && covers(g.scopeType, g.scopeId)),
    feature: candidates.length > 0 && feature,
    membership_ids: candidates.map((m) => m.id) };
}
