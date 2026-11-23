import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';
import { readFeatureEnabled } from './feature-reader.ts';

const PLAN_PERMISSION = 'manage:commission-plans:business';
const PAY_PERMISSION = 'pay:commissions:business';

/**
 * بيعيد قرار صلاحية العمولة وميزتها داخل معاملة قارئ، بلا أقفال كتابة.
 * الكاتب يعيد استخدام القرار نفسه بعد أقفاله؛ القائمة لا تحمل نتيجة الحارس من معاملة سابقة.
 *
 * @param tx معاملة الشركة الحالية
 * @param companyId الشركة المطلوبة
 * @param userId المستخدم البشري
 * @param businessId النشاط المطلوب
 * @param permission صلاحية العمولة المطلوبة
 * @returns سبب الرفض، أو null عند السماح
 */
async function readCommissionBusinessAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  permission: string,
): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null> {
  const [business] = await tx.execute(sql`SELECT id FROM businesses
    WHERE company_id=${companyId} AND id=${businessId}
      AND EXISTS (SELECT 1 FROM companies WHERE id=${companyId} AND deleted_at IS NULL)`);
  if (business === undefined) return 'FORBIDDEN';
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) return 'FORBIDDEN';
  const access = await readAccessTransaction(tx, companyId, userId, new Date(time.at));
  if (!evaluateAccess(access.grants, permission, { companyId, businessId })) return 'FORBIDDEN';
  return (await readFeatureEnabled(tx, companyId, 'commissions', new Date(time.at)))
    ? null
    : 'FEATURE_DISABLED';
}

/** يقفل الشركة وعضوياتها ثم يعيد قرار صلاحية الخطة وميزة العمولات داخل معاملة الكاتب. */
export async function readCommissionPlanAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null> {
  // تغيير الصلاحية بياخد أقفال الشركة والعضويات، فالمراجعة والكتابة يستنّوه أو هو يستنّاهم.
  const [company] = await tx.execute(
    sql`SELECT id FROM companies WHERE id=${companyId} AND deleted_at IS NULL FOR SHARE`,
  );
  if (company === undefined) return 'FORBIDDEN';
  await tx.execute(
    sql`SELECT id FROM memberships WHERE company_id=${companyId} ORDER BY id FOR SHARE`,
  );
  return readCommissionBusinessAccess(tx, companyId, userId, businessId, PLAN_PERMISSION);
}

/**
 * بيعيد قرار صلاحية العمولة والميزة للقائمة داخل معاملة القراءة، من غير أقفال كتابة.
 * الكاتب يعيد استخدام القرار نفسه بعد أقفاله؛ القائمة لا تحمل نتيجة الحارس من معاملة سابقة.
 *
 * @param tx معاملة الشركة الحالية
 * @param companyId الشركة المطلوبة
 * @param userId المستخدم البشري
 * @param businessId النشاط المطلوب
 * @returns سبب الرفض، أو null عند السماح
 */
export async function readCommissionPlanListAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null> {
  return readCommissionBusinessAccess(tx, companyId, userId, businessId, PLAN_PERMISSION);
}

/**
 * يقفل الشركة وعضوياتها ثم يعيد قرار صلاحية صرف كشف العمولة وميزة العمولات داخل معاملة الصرف (54-1).
 *
 * @param tx معاملة صرف الكشف الحالية
 * @param companyId الشركة المؤكدة
 * @param userId المستخدم البشري الفاعل
 * @param businessId نشاط الكشف المطلوب
 * @returns سبب الرفض، أو null عند السماح
 */
export async function readCommissionStatementPayAccess(
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
  return readCommissionBusinessAccess(tx, companyId, userId, businessId, PAY_PERMISSION);
}
