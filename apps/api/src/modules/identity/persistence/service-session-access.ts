import { canonicalOwnerSql, systemRoleGrantAllowedSql, systemRoleOverrideAllowedSql, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { evaluateAccess } from '../domain/access.ts';
import { protectOwnerAccess } from '../domain/owner-access.ts';
import type { SourcedGrant } from '../ports/access-reader.port.ts';
import { readFeatureEnabled } from './feature-reader.ts';

/** العضوية المرشحة ودورها كما هو في الجدول؛ الدور يُلتقط وقت الطلب (D-18). */
type CandidateRow = {
  id: string;
  owner: boolean;
  role_code: string;
  role_is_system: boolean;
  role_name_ar: string | null;
  role_name_en: string;
};

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
 * أدوار العضويات تُقرأ مع العضويات نفسها لأن لقطة دور الطالبة تُحفظ مع طلب الموافقة (D-18).
 *
 * @param tx معاملة المستهلك نفسها
 * @param companyId الشركة المؤكدة
 * @param userId مستخدمة حساب admin
 * @param businessId النشاط الذي أثبته tenancy
 * @param branchId فرع الزيارة
 * @param at وقت جديد بعد الأقفال لفحص انتهاء الإذن
 * @returns الإذن والمنع والميزة وهويات عضويات المتصلة بالفرع ودور كل عضوية
 */
export async function readServiceSessionAccess(tx: Tx, companyId: string, userId: string, businessId: string, branchId: string, at: Date) {
  const permission = 'record:service-sessions:branch';
  const target = { companyId, businessId, branchId };
  const covers = (scope: string, id: string) => (scope === 'COMPANY' && id === companyId) || (scope === 'BUSINESS' && id === businessId) || (scope === 'BRANCH' && id === branchId);
  const candidatesQuery = sql`SELECT m.id,(${canonicalOwnerSql('m',companyId)}) AS owner,
    r.code AS role_code,(m.role_owner_key='global')::boolean AS role_is_system,r.name_ar AS role_name_ar,r.name_en AS role_name_en
    FROM memberships m JOIN companies c ON c.id=m.company_id AND c.deleted_at IS NULL
    JOIN roles r ON r.id=m.role_id AND r.owner_key=m.role_owner_key
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
    tx.execute<CandidateRow>(candidatesQuery),
    tx.execute<SourcedGrant & Record<string, unknown>>(grantsQuery),
    readFeatureEnabled(tx, companyId, 'orders', at),
  ]);
  const grants = protectOwnerAccess(rows,candidates.some((m) => m.owner));
  return { record: candidates.length > 0 && evaluateAccess(grants, permission, target),
    denied: grants.some((g) => g.effect === 'DENY' && covers(g.scopeType, g.scopeId)),
    feature: candidates.length > 0 && feature,
    membership_ids: candidates.map((m) => m.id),
    memberships: candidates.map((m) => ({ membership_id: m.id,
      role: { code: m.role_code, is_system: m.role_is_system, name_ar: m.role_name_ar, name_en: m.role_name_en } })) };
}
