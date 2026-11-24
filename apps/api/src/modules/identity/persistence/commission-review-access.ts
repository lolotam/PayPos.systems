import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';
import { readCommissionScope } from './commission-read-scope.ts';
import { readFeatureEnabled } from './feature-reader.ts';

const PERMISSION = 'review:commissions:business';

/**
 * يقفل الشركة وعضوياتها ثم يعيد قرار «إنشاء الكشف ومراجعته» داخل معاملة الكاتب (FR-029): صلاحية
 * `review:commissions:business` على النشاط، وقارئ على مستوى النشاط كله (منح شركة أو نشاط ساري من غير
 * أي DENY على `read:commissions:business`) بنفس دالة النطاق اللي بيستعملها التقدير والعرض، مش دالة تانية؛
 * ومنح الفروع لو غطّت كل الفروع مش بيكفي (CS-Q26 = PP-24.1). كل رفض 403 موحّد بنفس الشكل، فصاحب
 * المراجعة من غير قراءة النشاط كله مش بيعرف إن الصلاحية هي الناقصة. الأقفال زي كاتب الخطة: سحب الصلاحية
 * بياخد أقفال الشركة والعضويات، فالكتابة تستناه أو هو يستناها.
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
  const access = await readAccessTransaction(tx, companyId, userId, at);
  if (!evaluateAccess(access.grants, PERMISSION, { companyId, businessId })) return 'FORBIDDEN';
  const scope = await readCommissionScope(tx, companyId, userId, businessId, at);
  if (scope.kind !== 'scope' || !scope.scope.businessWide) return 'FORBIDDEN';
  return (await readFeatureEnabled(tx, companyId, 'commissions', at)) ? null : 'FEATURE_DISABLED';
}
