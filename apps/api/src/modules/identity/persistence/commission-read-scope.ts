import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { readAccessTransaction } from './access-reader.ts';
import { readFeatureEnabled } from './feature-reader.ts';

const PERMISSION = 'read:commissions:business';

/**
 * النطاق الفعّال للقارئ على مستوى النشاط (CS-Q20 = PP-20.1): إما النشاط كله أو
 * مجموعة فروع محددة. unions الفروع الممنوحة ناقص الفروع الممنوعة، ونطاق الشركة
 * أو النشاط بيغطي فروع النشاط كله.
 */
export interface EffectiveCommissionScope {
  /**
   * القارئ يمسك صلاحية على مستوى الشركة أو النشاط بلا DENY ساري، فتشوف كل موظفات
   * النشاط وكل صف من صفوفهن حتى الصف اللي مالوش فرع مربوط.
   */
  readonly businessWide: boolean;
  /** الفروع المسموحة قراءتها، مرتبة تصاعدياً. */
  readonly branchIds: readonly string[];
}

/** نتيجة فحص النطاق: نطاق فعّال، أو رفض موحّد، أو ميزة مقفولة. */
export type CommissionScopeResult =
  | { readonly kind: 'scope'; readonly scope: EffectiveCommissionScope }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'feature_disabled' };

/**
 * يحل النطاق الفعّال للقارئ داخل معاملة القراءة نفسها (CS-Q20): اتحاد الفروع الممنوحة
 * من عضوياته السارية ومنحها السارية ناقص كل فرع غطاه DENY ساري، والعرض على مستوى
 * الشركة أو النشاط بيغطي فروع النشاط كله. المنح المنتهية بتتجاهل، والDENY بيغلب.
 * القارئ على مستوى الفروع بس يفضل فرعاً محدداً حتى لو مجموعة الفروع بتاعته غطّت كل
 * فروع النشاط (CM-23g)، والنطاق الفاضي رفض موحّد مش قائمة فاضية (CS-Q20).
 *
 * حماية المالك (ADR-0025) بتسبق هنا زي ما هي في قارئ الهوية العام: عضوية المالك
 *Canonical سارية بتلغي DENY من أي عضوية شقيقة، فالمالك بيقى على نطاق النشاط. ده
 * تعارض مقصود مع النص المطلق في CS-Q20، والقرار إن حماية المالك تغلب لأنها قاعدة
 * عامة في المنتج، والاختبار بيثبتها في مسار التقدير نفسه.
 *
 * @param tx معاملة الشركة الحالية
 * @param companyId الشركة المؤكدة
 * @param userId المستخدم البشري الفاعل
 * @param businessId النشاط المطلوب
 * @param decisionAt توقيت قرار اختياري للمتصلين اللي بيقراون تحت أقفالهم؛ غيابه بيعيّن التوقيت
 *                   من الساعة هنا زي ما كان، فسلوك باقي المستدعين ما بيتبدلش.
 * @returns النطاق الفعّال أو سبب الرفض
 */
export async function readCommissionScope(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  decisionAt?: Date,
): Promise<CommissionScopeResult> {
  const [business] = await tx.execute(sql`SELECT id FROM businesses
    WHERE company_id=${companyId} AND id=${businessId}
      AND EXISTS (SELECT 1 FROM companies WHERE id=${companyId} AND deleted_at IS NULL)`);
  if (business === undefined) return { kind: 'forbidden' };
  // توقيت القرار بيتمرر من المتصلين اللي بيقراون تحت أقفالهم (فحص واحد لتوقيت واحد)،
  // ولما يتغاب بيتعيّن من الساعة هنا بالظبط زي ما كان، فسلوك باقي المستدعين ما بيتبدلش.
  let at: Date;
  if (decisionAt === undefined) {
    const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
    if (time === undefined) return { kind: 'forbidden' };
    at = new Date(time.at);
  } else {
    at = decisionAt;
  }
  const access = await readAccessTransaction(tx, companyId, userId, at);
  const mine = access.grants.filter((grant) => grant.permission === PERMISSION);
  const allows = mine.filter((grant) => grant.effect === 'ALLOW');
  const denies = mine.filter((grant) => grant.effect === 'DENY');
  const rows = await tx.execute<{ id: string }>(sql`SELECT id FROM branches
    WHERE company_id=${companyId} AND business_id=${businessId} ORDER BY id`);
  const branchIds = rows.map((row) => row.id);
  const businessWideAllow = allows.some((grant) => coversBusiness(grant, companyId, businessId));
  // DENY بيخص النشاط المطلوب بس: denial على نشاط شقيق أو فرع تاني مش بيخصم
  // من صلاحية النشاط ده. Denial على الشركة أو على النشاط ده بغيّر النطاق من
  // مستوى النشاط لفرع (CM-23g).
  const relevantDenies = denies.filter((deny) => coversRequest(deny, companyId, businessId, branchIds));
  if (businessWideAllow && relevantDenies.length === 0) {
    return { kind: 'scope', scope: { businessWide: true, branchIds } };
  }
  const denied = deniedBranches(relevantDenies, companyId, businessId, branchIds);
  const allowed = allowedBranches(allows, companyId, businessId, branchIds);
  const effective = [...allowed].filter((id) => !denied.has(id)).sort();
  if (effective.length === 0) return { kind: 'forbidden' };
  return { kind: 'scope', scope: { businessWide: false, branchIds: effective } };
}

/**
 * DENY بيخص الطلب: نطاق الشركة أو النشاط المطلوب بيغطي الطلب كله، ونطاق الفرع
 * بيخص الطلب لو الفرع من فروع النشاط المطلوب. أي denial تاني (نشاط شقيق أو
 * فرع تاني) مش بخص الطلب ده.
 */
function coversRequest(
  deny: { readonly scopeType: string; readonly scopeId: string },
  companyId: string,
  businessId: string,
  branchIds: readonly string[],
): boolean {
  if (coversBusiness(deny, companyId, businessId)) return true;
  return deny.scopeType === 'BRANCH' && branchIds.includes(deny.scopeId);
}

/** منح على مستوى الشركة أو النشاط بيغطي كل فروع النشاط. */
function coversBusiness(
  grant: { readonly scopeType: string; readonly scopeId: string },
  companyId: string,
  businessId: string,
): boolean {
  if (grant.scopeType === 'COMPANY') return grant.scopeId === companyId;
  return grant.scopeType === 'BUSINESS' && grant.scopeId === businessId;
}

/** الفروع اللي غطاها DENY ساري: نطاق الشركة أو النشاط بيغطي الفروع كلها. */
function deniedBranches(
  denies: readonly { readonly scopeType: string; readonly scopeId: string }[],
  companyId: string,
  businessId: string,
  branchIds: readonly string[],
): Set<string> {
  const denied = new Set<string>();
  for (const deny of denies) {
    if (coversBusiness(deny, companyId, businessId)) {
      for (const id of branchIds) denied.add(id);
      continue;
    }
    if (deny.scopeType === 'BRANCH' && branchIds.includes(deny.scopeId)) denied.add(deny.scopeId);
  }
  return denied;
}

/** الفروع اللي سمح بها ALLOW ساري: نطاق الشركة أو النشاط بيغطي الفروع كلها. */
function allowedBranches(
  allows: readonly { readonly scopeType: string; readonly scopeId: string }[],
  companyId: string,
  businessId: string,
  branchIds: readonly string[],
): Set<string> {
  const allowed = new Set<string>();
  for (const allow of allows) {
    if (coversBusiness(allow, companyId, businessId)) {
      for (const id of branchIds) allowed.add(id);
      continue;
    }
    if (allow.scopeType === 'BRANCH' && branchIds.includes(allow.scopeId)) allowed.add(allow.scopeId);
  }
  return allowed;
}

/**
 * يقرأ ميزة العمولات بنفس معاملة القراءة، عشان الرفض يبقى FEATURE_DISABLED زي
 * ما بقية مسارات العمولات بتعمل.
 *
 * @param tx معاملة الشركة الحالية
 * @param companyId الشركة المؤكدة
 * @returns هل الميزة مفعّلة للشركة
 */
export async function readCommissionFeatureEnabled(tx: Tx, companyId: string): Promise<boolean> {
  return readFeatureEnabled(tx, companyId, 'commissions');
}
