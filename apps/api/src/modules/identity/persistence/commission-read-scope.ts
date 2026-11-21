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
 * @param tx معاملة الشركة الحالية
 * @param companyId الشركة المؤكدة
 * @param userId المستخدم البشري الفاعل
 * @param businessId النشاط المطلوب
 * @returns النطاق الفعّال أو سبب الرفض
 */
export async function readCommissionScope(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
): Promise<CommissionScopeResult> {
  const [business] = await tx.execute(sql`SELECT id FROM businesses
    WHERE company_id=${companyId} AND id=${businessId}
      AND EXISTS (SELECT 1 FROM companies WHERE id=${companyId} AND deleted_at IS NULL)`);
  if (business === undefined) return { kind: 'forbidden' };
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) return { kind: 'forbidden' };
  const at = new Date(time.at);
  const access = await readAccessTransaction(tx, companyId, userId, at);
  const mine = access.grants.filter((grant) => grant.permission === PERMISSION);
  const allows = mine.filter((grant) => grant.effect === 'ALLOW');
  const denies = mine.filter((grant) => grant.effect === 'DENY');
  const rows = await tx.execute<{ id: string }>(sql`SELECT id FROM branches
    WHERE company_id=${companyId} AND business_id=${businessId} ORDER BY id`);
  const branchIds = rows.map((row) => row.id);
  const inBusiness = new Set(branchIds);
  const businessWideAllow = allows.some(
    (grant) =>
      grant.scopeType === 'COMPANY' ||
      (grant.scopeType === 'BUSINESS' && grant.scopeId === businessId),
  );
  // القارئ على مستوى النشاط يبقى محدوداً لو فيه DENY ساري من أي نطاق، فالمفاضلة
  // بتنتقل لفلتر الفروع بدل ما يشوف كل النشاط (CM-23g).
  if (businessWideAllow && denies.length === 0) {
    return { kind: 'scope', scope: { businessWide: true, branchIds } };
  }
  const denied = new Set<string>();
  for (const deny of denies) {
    if (deny.scopeType === 'COMPANY') for (const id of branchIds) denied.add(id);
    else if (deny.scopeType === 'BUSINESS' && deny.scopeId === businessId)
      for (const id of branchIds) denied.add(id);
    else if (deny.scopeType === 'BRANCH' && inBusiness.has(deny.scopeId)) denied.add(deny.scopeId);
  }
  const allowed = new Set<string>();
  for (const allow of allows) {
    if (allow.scopeType === 'COMPANY') for (const id of branchIds) allowed.add(id);
    else if (allow.scopeType === 'BUSINESS' && allow.scopeId === businessId)
      for (const id of branchIds) allowed.add(id);
    else if (allow.scopeType === 'BRANCH' && inBusiness.has(allow.scopeId))
      allowed.add(allow.scopeId);
  }
  const effective = [...allowed].filter((id) => !denied.has(id)).sort();
  if (effective.length === 0) return { kind: 'forbidden' };
  return { kind: 'scope', scope: { businessWide: false, branchIds: effective } };
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
