import type { Tx } from '@pospay/db';
import { systemRoleGrantAllowedSql, systemRoleOverrideAllowedSql } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';
import { readCommissionScope } from './commission-read-scope.ts';
import { readFeatureEnabled } from './feature-reader.ts';

/** اعتماد كشف العمولة: صلاحية على مستوى النشاط، والمالك وحده يمنحها (CS-Q5). */
const APPROVE_PERMISSION = 'approve:commissions:business';
/** إنشاء كشف العمولة ومراجعته (CS-Q2b = PP-25.1). */
const REVIEW_PERMISSION = 'review:commissions:business';

/** سبب رفض الكتابة على مستوى القاعدة: الرفض الموحّد 403 أو الميزة المقفولة. */
export type CommissionApprovalAccess =
  | 'FORBIDDEN'
  | 'FEATURE_DISABLED'
  | null;

/**
 * فحص «يقبل الاعتماد» بنفس دالة النطاق اللي بيستعملها العرض والتقدير (FR-030، FR-036):
 * صلاحية `approve:commissions:business` على النشاط، وقارئ على مستوى النشاط كله (منح شركة أو نشاط
 * ساري من غير أي DENY على `read:commissions:business`). منح الفروع لو غطّت كل الفروع مش بيكفي
 * (CS-Q26 = PP-24.1، CM-33d).
 * الدالة دي هي نفس شرط زرار الاعتماد، فمحدش بياخد إشعار بحاجة الزرار هيرفضها له، وزرار الاعتماد
 * نفسه (53-2) بيستعمل الشرط ده.
 *
 * @param tx معاملة الكاتب الحالية
 * @param companyId الشركة المؤكدة
 * @param userId المستخدم البشري الفاعل
 * @param businessId النشاط المطلوب
 * @returns هل الفاعل يقبل الاعتماد على النشاط ده
 */
export async function commissionApproverHolds(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
): Promise<boolean> {
  const access = await readAccessTransaction(tx, companyId, userId);
  if (!evaluateAccess(access.grants, APPROVE_PERMISSION, { companyId, businessId })) return false;
  return isBusinessWideReader(tx, companyId, userId, businessId);
}

/**
 * فحص «إرجاع كشف مراجَع» (FR-031): صاحب مراجعة **أو** صاحب اعتماد، وكلهم قارئ على مستوى النشاط
 * كله. الإرجاع بيخلي الكشف يرجع مسودة، فمين يرجّعه لازم يكون شافف الكشف كله زي المراجع نفسه
 * (CM-33d، CM-38b). الرفض الموحّد 403 في كل الحالات.
 *
 * @param tx معاملة الكاتب الحالية
 * @param companyId الشركة المؤكدة
 * @param userId المستخدم البشري الفاعل
 * @param businessId النشاط المطلوب
 * @returns سبب الرفض، أو null عند السماح
 */
export async function readCommissionReturnAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
): Promise<CommissionApprovalAccess> {
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) return 'FORBIDDEN';
  const at = new Date(time.at);
  const access = await readAccessTransaction(tx, companyId, userId, at);
  const target = { companyId, businessId };
  const holds =
    evaluateAccess(access.grants, REVIEW_PERMISSION, target) ||
    evaluateAccess(access.grants, APPROVE_PERMISSION, target);
  if (!holds) return 'FORBIDDEN';
  if (!(await isBusinessWideReader(tx, companyId, userId, businessId))) return 'FORBIDDEN';
  return (await readFeatureEnabled(tx, companyId, 'commissions', at)) ? null : 'FEATURE_DISABLED';
}

/**
 * عضوية الفاعل اللي بتتسجل مع المراجعة أو الإرجاع (FR-029، FR-031): مرتبطة بالمستخدم
 * عشان مفتاح صف الكشف Compound (الشركة، اليوزر، العضوية) يبقى صحيح.
 * العضوية على مستوى الشركة أو النشاط هي اللي تقدر تحمّل صلاحية النشاط كله، فهي الأولى في الترتيب؛
 * وأي عضوية سارية تانية بتدخل كبديل عشان السجل يبقى صحيح في كل الأحوال.
 *
 * @param tx معاملة الكاتب الحالية
 * @param companyId الشركة المؤكدة
 * @param userId المستخدم البشري الفاعل
 * @returns معرّف العضوية السارية، أو null لو مفيش عضوية سارية
 */
export async function readCommissionActorMembership(
  tx: Tx,
  companyId: string,
  userId: string,
): Promise<string | null> {
  const [row] = await tx.execute<{ id: string }>(sql`SELECT id FROM memberships
    WHERE company_id = ${companyId}::uuid AND user_id = ${userId}::uuid
      AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
    ORDER BY (CASE WHEN scope_type IN ('COMPANY','BUSINESS') THEN 0 ELSE 1 END), id
    LIMIT 1`);
  return row?.id ?? null;
}

/**
 * أصحاب صلاحية الاعتماد اللي شايفين النشاط كله وقت الحدث: هم مستلمو إشعار «الكشف مستني
 * الاعتماد» (FR-030، CS-Q52 = PP-227). الفحص هو نفس فحص زرار الاعتماد: نفس الصلاحية ونفس شرط
 * القراءة على مستوى النشاط، فمحدش بيوصّله إشعار بحاجة الزرار هيرفضها له.
 * لحظة السريان هي ساعة قاعدة البيانات، زي قارئات الهوية التانية.
 *
 * @param tx معاملة الكاتب الحالية
 * @param companyId الشركة
 * @param businessId النشاط المطلوب
 * @returns معرّفات المستخدمين المؤهلين مرتبة تصاعدياً
 */
export async function readCommissionApprovers(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<readonly string[]> {
  const candidates = await readApproveCandidates(tx, companyId);
  const approvers: string[] = [];
  for (const userId of candidates) {
    if (await commissionApproverHolds(tx, companyId, userId, businessId)) approvers.push(userId);
  }
  return approvers.sort();
}

/**
 * قارئ على مستوى النشاط كله: منح شركة أو نشاط ساري على `read:commissions:business` من غير أي
 * DENY يغطي النشاط أو أي فرع من فروعه (CS-Q26 = PP-24.1). نفس دالة النطاق اللي بتحدد القارئ
 * في العرض والتقدير.
 */
async function isBusinessWideReader(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
): Promise<boolean> {
  const scope = await readCommissionScope(tx, companyId, userId, businessId);
  return scope.kind === 'scope' && scope.scope.businessWide;
}

/**
 * المرشحون: الأعضاء النشطون اللي عندهم منحة اعتماد على مستوى الشركة أو النشاط. دي نسخة واسعة
 * من القرار النهائي؛ الفحص الفعلي بيحصل فوق بدالة الوصول نفسها.
 */
async function readApproveCandidates(tx: Tx, companyId: string): Promise<readonly string[]> {
  const rows = await tx.execute<{ user_id: string }>(sql`
    SELECT DISTINCT m.user_id
    FROM memberships m
    JOIN role_permissions rp ON rp.role_id = m.role_id AND rp.role_owner_key = m.role_owner_key
    WHERE m.company_id = ${companyId} AND m.user_id IS NOT NULL
      AND m.starts_at <= now() AND (m.ends_at IS NULL OR m.ends_at > now())
      AND rp.permission_code = ${APPROVE_PERMISSION}
      AND m.scope_type IN ('COMPANY','BUSINESS')
      AND ${systemRoleGrantAllowedSql('m', 'rp')}
    UNION
    SELECT DISTINCT o_m.user_id
    FROM permission_overrides o
    JOIN memberships o_m ON o_m.company_id = o.company_id AND o_m.id = o.membership_id
    WHERE o.company_id = ${companyId} AND o_m.user_id IS NOT NULL
      AND o_m.starts_at <= now() AND (o_m.ends_at IS NULL OR o_m.ends_at > now())
      AND o.permission_code = ${APPROVE_PERMISSION} AND o.effect = 'ALLOW'
      AND o.scope_type IN ('COMPANY','BUSINESS')
      AND (o.expires_at IS NULL OR o.expires_at > now())
      AND ${systemRoleOverrideAllowedSql('o_m', 'o')}
    ORDER BY 1`);
  return rows.map((row) => row.user_id);
}
