import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { readBusinessWideCommissionActor } from './commission-read-scope.ts';
import { readFeatureEnabled } from './feature-reader.ts';

const PERMISSION = 'review:commissions:business' as const;

/**
 * يقفل الشركة وعضوياتها ثم يعيد قرار «إنشاء الكشف ومراجعته» داخل معاملة الكاتب (FR-029): صلاحية
 * `review:commissions:business` على النشاط، وقارئ على مستوى النشاط كله (منح شركة أو نشاط ساري من غير
 * أي DENY على `read:commissions:business`) بنفس دالة النطاق اللي بيستعملها التقدير والعرض، مش دالة تانية؛
 * ومنح الفروع لو غطّت كل الفروع مش بيكفي (CS-Q26 = PP-24.1). كل رفض 403 موحّد بنفس الشكل، فصاحب
 * المراجعة من غير قراءة النشاط كله مش بيعرف إن الصلاحية هي الناقصة. الأقفال زي كاتب الخطة: سحب الصلاحية
 * بياخد أقفال الشركة والعضويات، فالكتابة تستناه أو هو يستناها.
 *
 * القرار نفسه بيتقاس بالمسند المشترك في النواة مع فلتر المستلمين في العامل (FR-030، CM-58b)،
 * فما يصح تتفرق القاعدة بين نقطة النهاية والحدث.
 *
 * @param tx معاملة الكاتب الحالية
 * @param companyId الشركة المؤكدة
 * @param userId المستخدم البشري الفاعل
 * @param businessId النشاط المطلوب
 * @returns سبب الرفض، أو null عند السماح
 */
export async function readCommissionReviewAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null> {
  const [company] = await tx.execute(
    sql`SELECT id FROM companies WHERE id=${companyId} AND deleted_at IS NULL FOR SHARE`,
  );
  if (company === undefined) return 'FORBIDDEN';
  await tx.execute(
    sql`SELECT id FROM memberships WHERE company_id=${companyId} ORDER BY id FOR SHARE`,
  );
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) return 'FORBIDDEN';
  const at = new Date(time.at);
  const eligible = await readBusinessWideCommissionActor(
    tx,
    companyId,
    userId,
    businessId,
    PERMISSION,
    at,
  );
  if (!eligible) return 'FORBIDDEN';
  return (await readFeatureEnabled(tx, companyId, 'commissions', at)) ? null : 'FEATURE_DISABLED';
}

const APPROVE_PERMISSION = 'approve:commissions:business' as const;

/**
 * نفس قرار «الإنشاء والمراجعة» بالضبط لكن على صلاحية الاعتماد `approve:commissions:business` (ADR-0054 §7 الخطوة 1)، في
 * دالة مستقلة عن قارئ المراجعة كي لا يتأثر مساره. أقفال الشركة والعضويات تُؤخذ في أول نداء؛ أما إعادة الفحص بعد قفل
 * الشهور فتمر `locksHeld` فتتخطى القفلين لأن معاملة الاعتماد ما زالت تمسكهما (القفل المشترك يبقى حتى آخر المعاملة)، أما
 * الساعة والمنح والنطاق والميزة فتُقرأ من جديد في كل نداء لأن الانتظار على القفل قد يطول فتتغير الصلاحية.
 *
 * @param tx معاملة الاعتماد الحالية
 * @param companyId الشركة المؤكدة
 * @param userId المستخدم البشري الفاعل
 * @param businessId النشاط المطلوب
 * @param locksHeld هل أخذ نداء سابق في هذه المعاملة قفلي الشركة والعضويات
 * @returns سبب الرفض، أو null عند السماح
 */
export async function readCommissionApproveAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  locksHeld = false,
): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null> {
  if (!locksHeld) {
    const [company] = await tx.execute(
      sql`SELECT id FROM companies WHERE id=${companyId} AND deleted_at IS NULL FOR SHARE`,
    );
    if (company === undefined) return 'FORBIDDEN';
    await tx.execute(
      sql`SELECT id FROM memberships WHERE company_id=${companyId} ORDER BY id FOR SHARE`,
    );
  }
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) return 'FORBIDDEN';
  const at = new Date(time.at);
  const eligible = await readBusinessWideCommissionActor(
    tx,
    companyId,
    userId,
    businessId,
    APPROVE_PERMISSION,
    at,
  );
  if (!eligible) return 'FORBIDDEN';
  return (await readFeatureEnabled(tx, companyId, 'commissions', at)) ? null : 'FEATURE_DISABLED';
}
