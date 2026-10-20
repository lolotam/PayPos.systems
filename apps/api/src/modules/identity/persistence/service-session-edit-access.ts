import { canonicalOwnerSql, systemRoleGrantAllowedSql, systemRoleOverrideAllowedSql, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { AccessGrant, AccessTarget, ScopeType } from '../domain/access.ts';
import { evaluateAccess } from '../domain/access.ts';
import { protectOwnerAccess } from '../domain/owner-access.ts';
import { readFeatureEnabled } from './feature-reader.ts';
import { lockServiceSessionAccess } from './service-session-access.ts';

const EDIT_PERMISSION = 'edit:service-line-prices:branch';
const CANCEL_PERMISSION = 'cancel:service-lines:branch';
const PERFORMERS_PERMISSION = 'change:service-line-performers:branch';
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

interface ActorRole {
  code: string;
  is_system: boolean;
  name_ar: string | null;
  name_en: string;
}

interface LineAccess {
  denied: boolean;
  feature: boolean;
  can_read: boolean;
  eligible: readonly { membership_id: string; role: ActorRole }[];
}

/**
 * يحفظ سلطة تعديل سعر البند بنفس أقفال التسجيل المتوافقة مع الكتالوج.
 *
 * @param tx معاملة الشركة المستهلكة
 * @param companyId الشركة المؤكدة
 * @returns اكتمال قفل الشركة ثم العضويات بترتيب ثابت
 */
export async function lockServiceSessionEditAccess(tx: Tx, companyId: string): Promise<void> {
  await lockLineAccess(tx, companyId);
}

/**
 * يحفظ سلطة إلغاء البند بنفس أقفال التسجيل المتوافقة مع الكتالوج.
 *
 * @param tx معاملة الشركة المستهلكة
 * @param companyId الشركة المؤكدة
 * @returns اكتمال قفل الشركة ثم العضويات بترتيب ثابت
 */
export async function lockServiceSessionCancelAccess(tx: Tx, companyId: string): Promise<void> {
  await lockLineAccess(tx, companyId);
}

/**
 * يحفظ سلطة تغيير المنفّذين بنفس أقفال التسجيل المتوافقة مع الكتالوج.
 *
 * @param tx معاملة الشركة المستهلكة
 * @param companyId الشركة المؤكدة
 * @returns اكتمال قفل الشركة ثم العضويات بترتيب ثابت
 */
export async function lockServiceSessionPerformersAccess(tx: Tx, companyId: string): Promise<void> {
  await lockLineAccess(tx, companyId);
}

async function lockLineAccess(tx: Tx, companyId: string): Promise<void> {
  await lockServiceSessionAccess(tx, companyId);
}

/**
 * يعيد عضويات التعديل المؤهلة بذاتها، ومنع التعديل، وقراءة الزيارات، وميزة الطلبات عند اللحظة المحقونة.
 * المنع والقراءة يُحسبان على كل عضوية سارية لأن نطاق الـ override مستقل عن نطاق عضويته، والأهلية تبقى للعضوية التي تغطي الفرع وتمنح التعديل بذاتها.
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
): Promise<LineAccess> {
  return readLineAccess(tx, EDIT_PERMISSION, companyId, userId, businessId, branchId, at);
}

/**
 * يعيد عضويات الإلغاء المؤهلة بذاتها، ومنع الإلغاء، وقراءة الزيارات، وميزة الطلبات عند اللحظة المحقونة.
 * المنع والقراءة يُحسبان على كل عضوية سارية لأن نطاق الـ override مستقل عن نطاق عضويته، والأهلية تبقى للعضوية التي تغطي الفرع وتمنح الإلغاء بذاتها.
 *
 * @param tx معاملة المستهلك نفسها
 * @param companyId الشركة المؤكدة
 * @param userId مستخدمة الإلغاء
 * @param businessId النشاط الذي أثبته النطاق
 * @param branchId فرع الزيارة
 * @param at وقت جديد بعد الأقفال لفحص سريان العضوية
 * @returns المنع والميزة وحق القراءة والعضويات التي يمنح دورها الإلغاء على هذا الفرع
 */
export async function readServiceSessionCancelAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
  at: Date,
): Promise<LineAccess> {
  return readLineAccess(tx, CANCEL_PERMISSION, companyId, userId, businessId, branchId, at);
}

/**
 * يعيد عضويات تغيير المنفّذين المؤهلة بذاتها، ومنع التغيير، وقراءة الزيارات، وميزة الطلبات عند اللحظة المحقونة.
 * المنع والقراءة يُحسبان على كل عضوية سارية لأن نطاق الـ override مستقل عن نطاق عضويته، والأهلية تبقى للعضوية التي تغطي الفرع وتمنح تغيير المنفّذين بذاتها.
 *
 * @param tx معاملة المستهلك نفسها
 * @param companyId الشركة المؤكدة
 * @param userId مستخدمة التغيير
 * @param businessId النشاط الذي أثبته النطاق
 * @param branchId فرع الزيارة
 * @param at وقت جديد بعد الأقفال لفحص سريان العضوية
 * @returns المنع والميزة وحق القراءة والعضويات التي يمنح دورها تغيير المنفّذين على هذا الفرع
 */
export async function readServiceSessionPerformersAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
  at: Date,
): Promise<LineAccess> {
  return readLineAccess(tx, PERFORMERS_PERMISSION, companyId, userId, businessId, branchId, at);
}

async function readLineAccess(
  tx: Tx,
  permission: string,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
  at: Date,
): Promise<LineAccess> {
  const target = { companyId, businessId, branchId };
  const [candidates, principal, featureOn] = await Promise.all([
    candidateMemberships(tx, companyId, userId, businessId, branchId, at),
    principalAccess(tx, companyId, userId, at, permission),
    readFeatureEnabled(tx, companyId, 'orders', at),
  ]);
  return decideLineAccess(candidates, principal, featureOn && candidates.length > 0, target, permission);
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

type OwnerRow = { owner: boolean };

async function principalAccess(tx: Tx, companyId: string, userId: string, at: Date, writePermission: string) {
  const instant = at.toISOString();
  const active = sql`m.company_id=${companyId} AND m.user_id=${userId}
    AND m.starts_at<=${instant}::timestamptz AND (m.ends_at IS NULL OR m.ends_at>${instant}::timestamptz)`;
  const permissions = sql`${writePermission}, ${READ_PERMISSION}`;
  const [owners, rows] = await Promise.all([
    tx.execute<OwnerRow>(sql`SELECT COALESCE(bool_or((${canonicalOwnerSql('m', companyId)})::boolean), false) AS owner
      FROM memberships m WHERE ${active}`),
    tx.execute<GrantRow>(sql`SELECT m.id AS membership_id,rp.permission_code AS permission,'ALLOW' AS effect,
        m.scope_type AS "scopeType",m.scope_id AS "scopeId" FROM memberships m
      JOIN role_permissions rp ON rp.role_id=m.role_id AND rp.role_owner_key=m.role_owner_key
      WHERE ${active} AND rp.permission_code IN (${permissions}) AND ${systemRoleGrantAllowedSql('m', 'rp')}
      UNION ALL SELECT m.id,o.permission_code,o.effect,o.scope_type,o.scope_id FROM permission_overrides o
      JOIN memberships m ON m.company_id=o.company_id AND m.id=o.membership_id
      WHERE ${active} AND o.permission_code IN (${permissions})
        AND (o.expires_at IS NULL OR o.expires_at>${instant}::timestamptz)
        AND ${systemRoleOverrideAllowedSql('m', 'o')}`),
  ]);
  return { owner: owners[0]?.owner === true, grants: grantRows(rows) };
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

function decideLineAccess(
  candidates: readonly CandidateRow[],
  principal: { owner: boolean; grants: readonly (AccessGrant & { membership_id: string })[] },
  feature: boolean,
  target: AccessTarget,
  writePermission: string,
): LineAccess {
  const visible = protectOwnerAccess(principal.grants, principal.owner);
  const covers = (scope: string, id: string) =>
    (scope === 'COMPANY' && id === target.companyId) ||
    (scope === 'BUSINESS' && id === target.businessId) ||
    (scope === 'BRANCH' && id === target.branchId);
  return {
    denied: visible.some((grant) => grant.permission === writePermission && grant.effect === 'DENY' && covers(grant.scopeType, grant.scopeId)),
    feature,
    can_read: evaluateAccess(visible, READ_PERMISSION, target),
    eligible: candidates.filter((candidate) => evaluateAccess(visible.filter((grant) => grant.membership_id === candidate.id), writePermission, target)).map((candidate) => ({
      membership_id: candidate.id,
      role: { code: candidate.role_code, is_system: candidate.role_is_system, name_ar: candidate.role_name_ar, name_en: candidate.role_name_en },
    })),
  };
}
