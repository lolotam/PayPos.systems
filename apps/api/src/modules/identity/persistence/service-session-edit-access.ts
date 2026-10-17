import { canonicalOwnerSql, systemRoleGrantAllowedSql, systemRoleOverrideAllowedSql, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { AccessGrant, AccessTarget, ScopeType } from '../domain/access.ts';
import { evaluateAccess } from '../domain/access.ts';
import { protectOwnerAccess } from '../domain/owner-access.ts';
import { readFeatureEnabled } from './feature-reader.ts';
import { lockServiceSessionAccess } from './service-session-access.ts';

const EDIT_PERMISSION = 'edit:service-line-prices:branch';
const READ_PERMISSION = 'read:service-sessions:branch';

type CandidateRow = {
  id: string;
  owner: boolean;
  role_code: string;
  role_is_system: boolean;
  role_name_ar: string | null;
  role_name_en: string;
};

type GrantRow = {
  membership_id: string;
  permission: string;
  effect: string;
  scopeType: string;
  scopeId: string;
};

interface EditorRole {
  code: string;
  is_system: boolean;
  name_ar: string | null;
  name_en: string;
}

interface EditAccess {
  denied: boolean;
  feature: boolean;
  can_read: boolean;
  eligible: readonly { membership_id: string; role: EditorRole }[];
}

/**
 * يحفظ سلطة تعديل سعر البند بنفس أقفال التسجيل المتوافقة مع الكتالوج.
 *
 * @param tx معاملة الشركة المستهلكة
 * @param companyId الشركة المؤكدة
 * @returns اكتمال قفل الشركة ثم العضويات بترتيب ثابت
 */
export async function lockServiceSessionEditAccess(tx: Tx, companyId: string): Promise<void> {
  await lockServiceSessionAccess(tx, companyId);
}

/**
 * يعيد عضويات التعديل المؤهلة بذاتها، ومنع التعديل، وقراءة الزيارات، وميزة الطلبات عند اللحظة المحقونة.
 * أهلية التعديل تُحسب لكل عضوية وحدها، وأي DENY يغطي الفرع يمنع التعديل كله بعد حماية المالك.
 *
 * @param tx معاملة المستهلك نفسها
 * @param companyId الشركة المؤكدة
 * @param userId مستخدمة التعديل
 * @param businessId النشاط الذي أثبته النطاق
 * @param branchId فرع الزيارة
 * @param at وقت جديد بعد الأقفال لفحص سريان العضوية
 * @returns المنع والميزة وحق القراءة والعضويات التي يمنح دورها التعديل على هذا الفرع
 */
export async function readServiceSessionEditAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
  at: Date,
): Promise<EditAccess> {
  const candidates = await candidateMemberships(tx, companyId, userId, businessId, branchId, at);
  if (candidates.length === 0) return { denied: false, feature: false, can_read: false, eligible: [] };
  const target = { companyId, businessId, branchId };
  const [rows, feature] = await Promise.all([
    candidateGrants(tx, companyId, userId, candidates.map((candidate) => candidate.id), at),
    readFeatureEnabled(tx, companyId, 'orders', at),
  ]);
  return decideEditAccess(candidates, grantRows(rows), feature, target);
}

async function candidateMemberships(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
  at: Date,
): Promise<CandidateRow[]> {
  const instant = at.toISOString();
  return tx.execute<CandidateRow>(sql`SELECT m.id,(${canonicalOwnerSql('m', companyId)})::boolean AS owner,
    r.code AS role_code,(m.role_owner_key = 'global')::boolean AS role_is_system,r.name_ar AS role_name_ar,r.name_en AS role_name_en
    FROM memberships m JOIN companies c ON c.id=m.company_id AND c.deleted_at IS NULL
    JOIN roles r ON r.id=m.role_id AND r.owner_key=m.role_owner_key
    WHERE m.company_id=${companyId} AND m.user_id=${userId} AND m.starts_at<=${instant}::timestamptz
      AND (m.ends_at IS NULL OR m.ends_at>${instant}::timestamptz)
      AND ((m.scope_type='COMPANY' AND m.scope_id=${companyId}) OR (m.scope_type='BUSINESS' AND m.scope_id=${businessId})
        OR (m.scope_type='BRANCH' AND m.scope_id=${branchId}))
    ORDER BY m.id`);
}

async function candidateGrants(tx: Tx, companyId: string, userId: string, membershipIds: readonly string[], at: Date) {
  const instant = at.toISOString();
  const ids = sql.join(membershipIds.map((id) => sql`${id}::uuid`), sql`, `);
  const active = sql`m.company_id=${companyId} AND m.user_id=${userId} AND m.id IN (${ids})
    AND m.starts_at<=${instant}::timestamptz AND (m.ends_at IS NULL OR m.ends_at>${instant}::timestamptz)`;
  const permissions = sql`${EDIT_PERMISSION}, ${READ_PERMISSION}`;
  return tx.execute<GrantRow>(sql`SELECT m.id AS membership_id,rp.permission_code AS permission,'ALLOW' AS effect,
      m.scope_type AS "scopeType",m.scope_id AS "scopeId" FROM memberships m
    JOIN role_permissions rp ON rp.role_id=m.role_id AND rp.role_owner_key=m.role_owner_key
    WHERE ${active} AND rp.permission_code IN (${permissions}) AND ${systemRoleGrantAllowedSql('m', 'rp')}
    UNION ALL SELECT m.id,o.permission_code,o.effect,o.scope_type,o.scope_id FROM permission_overrides o
    JOIN memberships m ON m.company_id=o.company_id AND m.id=o.membership_id
    WHERE ${active} AND o.permission_code IN (${permissions})
      AND (o.expires_at IS NULL OR o.expires_at>${instant}::timestamptz)
      AND ${systemRoleOverrideAllowedSql('m', 'o')}`);
}

function grantRows(rows: readonly GrantRow[]): Array<AccessGrant & { membership_id: string }> {
  return rows.map((row) => ({
    membership_id: row.membership_id,
    permission: row.permission,
    effect: grantEffect(row.effect),
    scopeType: grantScope(row.scopeType),
    scopeId: row.scopeId,
  }));
}

function grantEffect(effect: string): AccessGrant['effect'] {
  if (effect === 'ALLOW' || effect === 'DENY') return effect;
  throw new Error('Invalid grant effect');
}

function grantScope(scope: string): ScopeType {
  switch (scope) {
    case 'COMPANY':
    case 'BUSINESS':
    case 'BRANCH':
      return scope;
    default:
      throw new Error('Invalid grant scope');
  }
}

function decideEditAccess(
  candidates: readonly CandidateRow[],
  grants: readonly (AccessGrant & { membership_id: string })[],
  featureOn: boolean,
  target: AccessTarget,
): EditAccess {
  const visible = protectOwnerAccess(grants, candidates.some((candidate) => candidate.owner === true));
  const covers = (scope: string, id: string) =>
    (scope === 'COMPANY' && id === target.companyId) ||
    (scope === 'BUSINESS' && id === target.businessId) ||
    (scope === 'BRANCH' && id === target.branchId);
  return {
    denied: visible.some((grant) => grant.permission === EDIT_PERMISSION && grant.effect === 'DENY' && covers(grant.scopeType, grant.scopeId)),
    feature: featureOn,
    can_read: evaluateAccess(visible, READ_PERMISSION, target),
    eligible: candidates.filter((candidate) => evaluateAccess(visible.filter((grant) => grant.membership_id === candidate.id), EDIT_PERMISSION, target)).map((candidate) => ({
      membership_id: candidate.id,
      role: { code: candidate.role_code, is_system: candidate.role_is_system, name_ar: candidate.role_name_ar, name_en: candidate.role_name_en },
    })),
  };
}
