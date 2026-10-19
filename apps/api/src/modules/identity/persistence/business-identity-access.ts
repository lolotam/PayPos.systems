import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';

const PERMISSION = 'manage:business-identity:business';

/**
 * بيقفل الشركة النشطة ثم العضويات ثم النشاط قبل كتابة الاسم الرسمي.
 * الشركة المحذوفة أو النشاط الغايب بيترفضوا من غير ما يتكتب صف إعدادات، عشان الوجود ما يتكشفش.
 *
 * @param tx معاملة تعديل الهوية
 * @param companyId الشركة المتحقق منها
 * @param userId المستخدم
 * @param businessId النشاط
 * @returns FORBIDDEN أو null بعد القرار تحت الأقفال
 */
export async function lockBusinessIdentityAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
): Promise<'FORBIDDEN' | null> {
  const [company] = await tx.execute(sql`SELECT id FROM companies
    WHERE id=${companyId} AND deleted_at IS NULL FOR NO KEY UPDATE`);
  if (company === undefined) return 'FORBIDDEN';
  await tx.execute(
    sql`SELECT id FROM memberships WHERE company_id=${companyId} ORDER BY id FOR UPDATE`,
  );
  const [business] = await tx.execute(sql`SELECT id FROM businesses
    WHERE company_id=${companyId} AND id=${businessId} FOR SHARE`);
  if (business === undefined) return 'FORBIDDEN';
  return readBusinessIdentityAccess(tx, companyId, userId, businessId);
}

/**
 * بيعيد قرار صلاحية هوية النشاط بعد قفل صف الإعدادات، من غير أقفال جديدة.
 * وقت القرار هو وقت المعاملة بعد الانتظار، وصلاحية النشاط ما بتمشيش على منع فرع.
 *
 * @param tx معاملة الشركة والأقفال السابقة لسه قايمة
 * @param companyId الشركة
 * @param userId المستخدم
 * @param businessId النشاط
 * @returns FORBIDDEN أو null عند السماح
 */
export async function readBusinessIdentityAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
): Promise<'FORBIDDEN' | null> {
  const [business] = await tx.execute(sql`SELECT id FROM businesses
    WHERE company_id=${companyId} AND id=${businessId}
      AND EXISTS (SELECT 1 FROM companies WHERE id=${companyId} AND deleted_at IS NULL)`);
  if (business === undefined) return 'FORBIDDEN';
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) return 'FORBIDDEN';
  const access = await readAccessTransaction(tx, companyId, userId, new Date(time.at));
  return evaluateAccess(access.grants, PERMISSION, { companyId, businessId }) ? null : 'FORBIDDEN';
}
