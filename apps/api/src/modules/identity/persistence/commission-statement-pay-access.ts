import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';
import { readCommissionScope } from './commission-read-scope.ts';
import { readFeatureEnabled } from './feature-reader.ts';

const PERMISSION = 'pay:commissions:business';

/**
 * يقفل الشركة وعضوياتها ثم يعيد قرار صلاحية صرف كشف العمولة وميزة العمولات داخل معاملة الصرف (54-1).
 * نفس شكل مراجعة الكشف والخطة: أقفال الشركة والعضويات أولاً عشان تغيير الصلاحية يتفق مع الكاتب،
 * والرفض الموحّد قبل أي قراءة لبيانات الكشف. الصرف بيحتاج كمان قراءة النشاط كله (نفس دالة النطاق اللي بتستعملها
 * المراجعة والاعتماد)، لأن رد الصرف بيرجّع مستحق كل موظفة (قرار 54-1-PAY-1).
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
  const [business] = await tx.execute(sql`SELECT id FROM businesses
    WHERE company_id=${companyId} AND id=${businessId}
      AND EXISTS (SELECT 1 FROM companies WHERE id=${companyId} AND deleted_at IS NULL)`);
  if (business === undefined) return 'FORBIDDEN';
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) return 'FORBIDDEN';
  const at = new Date(time.at);
  const access = await readAccessTransaction(tx, companyId, userId, at);
  if (!evaluateAccess(access.grants, PERMISSION, { companyId, businessId })) return 'FORBIDDEN';
  const scope = await readCommissionScope(tx, companyId, userId, businessId, at);
  if (scope.kind !== 'scope' || !scope.scope.businessWide) return 'FORBIDDEN';
  return (await readFeatureEnabled(tx, companyId, 'commissions', at)) ? null : 'FEATURE_DISABLED';
}
