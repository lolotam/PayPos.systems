import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';

const PERMISSION = 'manage:settings:business';

/**
 * بيقفل الشركة النشطة ثم العضويات ثم النشاط (والفرع لو موجود) قبل كتابة قاعدة تنبيه، وبيقرر تحت الأقفال.
 * الصلاحية لازم تغطي النشاط كله (AL-Q1)، ولقاعدة فرع لازم كمان تغطي الفرع، فمنع (DENY) على الفرع بيرفض قاعدته
 * (spec 060 D-B13). فرع من نشاط تاني أو نشاط غايب بيرجعوا نفس FORBIDDEN عشان الوجود ما يتكشفش.
 *
 * @param tx معاملة تعديل القواعد
 * @param companyId الشركة المتحقق منها
 * @param userId المستخدم
 * @param target النشاط والفرع (null لقواعد النشاط والمفتاح العام)
 * @param target.businessId النشاط
 * @param target.branchId الفرع أو null
 * @returns FORBIDDEN أو null عند السماح
 */
export async function lockAlertRulesAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  target: { businessId: string; branchId: string | null },
): Promise<'FORBIDDEN' | null> {
  const [company] = await tx.execute(sql`SELECT id FROM companies
    WHERE id=${companyId} AND deleted_at IS NULL FOR NO KEY UPDATE`);
  if (company === undefined) return 'FORBIDDEN';
  await tx.execute(
    sql`SELECT id FROM memberships WHERE company_id=${companyId} ORDER BY id FOR UPDATE`,
  );
  const [business] = await tx.execute(sql`SELECT id FROM businesses
    WHERE company_id=${companyId} AND id=${target.businessId} FOR SHARE`);
  if (business === undefined) return 'FORBIDDEN';
  return readAlertRulesAccess(tx, companyId, userId, target, true);
}

/**
 * نفس قرار lockAlertRulesAccess من غير أقفال، لقراية قواعد فرع: صاحب الصلاحية على النشاط كله مع منع على الفرع
 * مايقراش قواعد الفرع ده (نفس قرار الكتابة).
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة المتحقق منها
 * @param userId المستخدم
 * @param target النشاط والفرع
 * @param target.businessId النشاط
 * @param target.branchId الفرع أو null
 * @param share قفل صف الفرع FOR SHARE (مسار الكتابة)
 * @returns FORBIDDEN أو null عند السماح
 */
export async function readAlertRulesAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  target: { businessId: string; branchId: string | null },
  share = false,
): Promise<'FORBIDDEN' | null> {
  if (target.branchId !== null) {
    const [branch] = await tx.execute(sql`SELECT id FROM branches
      WHERE company_id=${companyId} AND business_id=${target.businessId} AND id=${target.branchId} ${share ? sql`FOR SHARE` : sql``}`);
    if (branch === undefined) return 'FORBIDDEN';
  }
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) return 'FORBIDDEN';
  const access = await readAccessTransaction(tx, companyId, userId, new Date(time.at));
  const businessAllowed = evaluateAccess(access.grants, PERMISSION, {
    companyId,
    businessId: target.businessId,
  });
  const branchAllowed =
    target.branchId === null ||
    evaluateAccess(access.grants, PERMISSION, {
      companyId,
      businessId: target.businessId,
      branchId: target.branchId,
    });
  return businessAllowed && branchAllowed ? null : 'FORBIDDEN';
}
