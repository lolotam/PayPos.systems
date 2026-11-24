import type { Tx } from '@pospay/db';
import { systemRoleGrantAllowedSql, systemRoleOverrideAllowedSql } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';
import { readCommissionScope } from './commission-read-scope.ts';
import { readFeatureEnabled } from './feature-reader.ts';

/** صلاحية الاعتماد: أصحابها مستلمو إشعار «الكشف مستني الاعتماد» ومسموح لهم بالإرجاع (CS-Q5). */
const APPROVE_PERMISSION = 'approve:commissions:business';
/** صلاحية إنشاء الكشف ومراجعته (CS-Q2b = PP-25.1). */
const REVIEW_PERMISSION = 'review:commissions:business';

/** نتيجة فحص «يسمح بالإرجاع»: الرفض الموحّد 403 عند أي حالة غير مسموحة. */
export type CommissionApprovalAccess =
  | 'FORBIDDEN'
  | 'FEATURE_DISABLED'
  | null;

/**
 * يقفل الشركة أولاً بـ FOR SHARE ويرفض الشركة المحذوفة، ثم يقفل كل عضوية الشركة بـ FOR SHARE،
 * بنفس ترتيب مسار المراجعة بالظبط (FR-031 مع CS-Q26): سحب الصلاحية أو تعطيل الشركة اللي بيحصل
 * جوّه إدارة الصلاحيات بيستنى المعاملة دي بالترتيب ده، فما يقدرش يتبني التزام بين فحص الوصول
 * وتغيير حالة الكشف. التوقيت بيتقري بـ clock_timestamp() بعد الانتظار على الأقفال، هو القرار
 * الواحد لقراءة الصلاحية والكشف (Codex 4336152050). أخطاء قاعدة البيانات الحقيقية بتنتشر زي
 * ما هي، والرفض الموحّد للشركة الغايبة بس هو اللي بيرجع نتيجة.
 *
 * @param tx        معاملة الشركة الجارية
 * @param companyId الشركة
 * @returns توقيت القرار بعد انتظار الأقفال، أو null عند غياب الشركة
 */
async function lockCompanyAndMemberships(tx: Tx, companyId: string): Promise<Date | null> {
  const [company] = await tx.execute(
    sql`SELECT id FROM companies WHERE id=${companyId} AND deleted_at IS NULL FOR SHARE`,
  );
  if (company === undefined) return null;
  await tx.execute(
    sql`SELECT id FROM memberships WHERE company_id=${companyId} ORDER BY id FOR SHARE`,
  );
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) return null;
  return new Date(time.at);
}

/**
 * فحص «يسمح بالإرجاع» (FR-031): صاحب **أو** صاحب اعتماد وقارئ على مستوى النشاط كله. الإرجاع
 * بيتحقق جوّه المعاملة بالأقفال زي مسار المراجعة بالظبط، فسحب الصلاحية اللي بيتنافس معنا
 * بينتظر وبيقرا القرار بعده، وما يقدرش يتسلل بين الفحص والكتابة (CM-33d، CM-38b).
 *
 * @param tx        معاملة الشركة الجارية
 * @param companyId الشركة
 * @param userId    المستخدم
 * @param businessId النشاط
 * @returns النتيجة، أو null لما مسموح
 */
export async function readCommissionReturnAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
): Promise<CommissionApprovalAccess> {
  const at = await lockCompanyAndMemberships(tx, companyId);
  if (at === null) return 'FORBIDDEN';
  const access = await readAccessTransaction(tx, companyId, userId, at);
  const holds =
    evaluateAccess(access.grants, REVIEW_PERMISSION, { companyId, businessId }) ||
    evaluateAccess(access.grants, APPROVE_PERMISSION, { companyId, businessId });
  if (!holds) return 'FORBIDDEN';
  if (!(await isBusinessWideReader(tx, companyId, userId, businessId, at))) return 'FORBIDDEN';
  return (await readFeatureEnabled(tx, companyId, 'commissions', at)) ? null : 'FEATURE_DISABLED';
}

/**
 * فحص صلاحية الاعتماد لعضوية واحدة (CS-Q5، FR-030): صاحب `approve:commissions:business` قارئ
 * للنشاط كله (بدون أي DENY على `read:commissions:business`). لازم قارئ نشاط كله، فما بيكفيش
 * النشاط لو بلا قراءة ولا قراءة فرعية (CS-Q26 = PP-24.1).
 * التوقيت بيتمرر من المستدعي (القرار الواحد بعد انتظار أقفال المعاملة)، فاختيار المرشحين
 * وتقييم صلاحية كل واحد بيبنى على نفس اللحظة (Codex 4336152050).
 *
 * @param tx        معاملة الشركة الجارية
 * @param scope     هوية الفحص: الشركة والمستخدم والنشاط
 * @param at        توقيت القرار الواحد بعد انتظار الأقفال
 * @returns هل صاحب الاعتماد مؤهل
 */
export async function commissionApproverHolds(
  tx: Tx,
  scope: { companyId: string; userId: string; businessId: string },
  at: Date,
): Promise<boolean> {
  const access = await readAccessTransaction(tx, scope.companyId, scope.userId, at);
  if (
    !evaluateAccess(access.grants, APPROVE_PERMISSION, {
      companyId: scope.companyId,
      businessId: scope.businessId,
    })
  )
    return false;
  return isBusinessWideReader(tx, scope.companyId, scope.userId, scope.businessId, at);
}

/**
 * عضوية الفاعل السارية اللي بتتسجل مع المراجعة أو الإرجاع (FR-029، FR-031): عضوية تعطي الفاعل
 * سلطته على **النشاط ده** بالتحديد — نطاق شركة، أو نطاق النشاط المطلوب، أو عضوية فرع من فروع
 * النشاط ده — وعمّر ما بتتسجل عضوية نشاط تاني حتى لو هي الأقدم. الترتيب: نطاق الشركة، ثم
 * النشاط، ثم فرع النشاط، ثم المعرّف للثبات.
 *
 * @param tx         معاملة الشركة الجارية
 * @param companyId  الشركة
 * @param userId     المستخدم
 * @param businessId النشاط اللي بيتم عليه المراجعة أو الإرجاع
 * @returns معرّف العضوية، أو null لما مفيش عضوية سارية على النطاق المسموح
 */
export async function readCommissionActorMembership(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
): Promise<string | null> {
  const [row] = await tx.execute<{ id: string }>(sql`SELECT id FROM memberships
    WHERE company_id = ${companyId}::uuid AND user_id = ${userId}::uuid
      AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
      AND (scope_type = 'COMPANY'
        OR (scope_type = 'BUSINESS' AND scope_id = ${businessId}::uuid)
        OR (scope_type = 'BRANCH' AND scope_id IN (SELECT b.id FROM branches b
          WHERE b.company_id = ${companyId}::uuid AND b.business_id = ${businessId}::uuid)))
    ORDER BY (CASE WHEN scope_type = 'COMPANY' THEN 0 WHEN scope_type = 'BUSINESS' THEN 1
      ELSE 2 END), id
    LIMIT 1`);
  return row?.id ?? null;
}

/**
 * أصحاب صلاحية الاعتماد القارئين للنشاط كله وقت الحدث (FR-030، CS-Q52 = PP-227). القراءة بتحصل
 * جوّه معاملة المراجعة بعد قفل الكشف، وبتتاخم قرارة `clock_timestamp()` واحدة بعد الانتظار،
 * هي بتحدد المرشحين وتقييم كل مرشح معاً (Codex 4336152050). الترتيب تصاعدي، والتكرار محذوف،
 * والمقسّم بيحد المية لكل مجموعة.
 *
 * @param tx         معاملة الشركة الجارية
 * @param companyId  الشركة
 * @param businessId النشاط
 * @returns معرّفات المستخدمين المؤهلين تصاعدياً بلا تكرار
 */
export async function readCommissionApprovers(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<readonly string[]> {
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) return [];
  const at = new Date(time.at);
  const candidates = await readApproveCandidates(tx, companyId, at);
  const approvers: string[] = [];
  for (const userId of candidates) {
    if (await commissionApproverHolds(tx, { companyId, userId, businessId }, at))
      approvers.push(userId);
  }
  return approvers.sort();
}

/**
 * قارئ نطاق القراءة على مستوى النشاط كله: نطاق الشركة أو النشاط نفسه بلا DENY (CS-Q26 = PP-24.1).
 * بيقرا بتوقيت القرار الواحد المتمرر، فصلاحية الإجراء وقراءة النشاط كله متقيمين على نفس اللحظة.
 * عضوية فرع أو نشاط تاني ما بتعدّش قراءة نشاط كله، فالمراجعة والإرجاع بيرفضوها بالرفض الموحّد.
 */
async function isBusinessWideReader(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  at: Date,
): Promise<boolean> {
  const scope = await readCommissionScope(tx, companyId, userId, businessId, at);
  return scope.kind === 'scope' && scope.scope.businessWide;
}

/**
 * المرشحون: المستخدمون اللي صلاحية الاعتماد واصلة ليهم بنطاق شركة أو نشاط، والسارية كلها على
 * توقيت القرار الواحد `at` اللي جاي من المستدعي (Codex 4336152050) — والفحص النهائي لكل مرشح
 * بالأهلية الكاملة بيحصل في commissionApproverHolds بنفس التوقيت.
 */
async function readApproveCandidates(tx: Tx, companyId: string, at: Date): Promise<readonly string[]> {
  const decisionAt = sql`${at.toISOString()}::timestamptz`;
  const rows = await tx.execute<{ user_id: string }>(sql`
    SELECT DISTINCT m.user_id
    FROM memberships m
    JOIN role_permissions rp ON rp.role_id = m.role_id AND rp.role_owner_key = m.role_owner_key
    WHERE m.company_id = ${companyId} AND m.user_id IS NOT NULL
      AND m.starts_at <= ${decisionAt} AND (m.ends_at IS NULL OR m.ends_at > ${decisionAt})
      AND rp.permission_code = ${APPROVE_PERMISSION}
      AND m.scope_type IN ('COMPANY','BUSINESS')
      AND ${systemRoleGrantAllowedSql('m', 'rp')}
    UNION
    SELECT DISTINCT o_m.user_id
    FROM permission_overrides o
    JOIN memberships o_m ON o_m.company_id = o.company_id AND o_m.id = o.membership_id
    WHERE o.company_id = ${companyId} AND o_m.user_id IS NOT NULL
      AND o_m.starts_at <= ${decisionAt} AND (o_m.ends_at IS NULL OR o_m.ends_at > ${decisionAt})
      AND o.permission_code = ${APPROVE_PERMISSION} AND o.effect = 'ALLOW'
      AND o.scope_type IN ('COMPANY','BUSINESS')
      AND (o.expires_at IS NULL OR o.expires_at > ${decisionAt})
      AND ${systemRoleOverrideAllowedSql('o_m', 'o')}
    ORDER BY 1`);
  return rows.map((row) => row.user_id);
}
