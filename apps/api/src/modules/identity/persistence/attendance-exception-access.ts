import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';

/**
 * يثبت سلطة الشركة قبل قفل الاستثناء بنفس ترتيب الشركة ثم العضويات.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة المثبتة
 * @returns يكتمل بعد الأقفال أو يرفض الشركة المغلقة
 */
export async function lockAttendanceExceptionAccess(tx: Tx, companyId: string): Promise<boolean> {
  const [company] = await tx.execute(
    sql`SELECT id FROM companies WHERE id=${companyId} AND deleted_at IS NULL FOR NO KEY UPDATE`,
  );
  if (!company) return false;
  await tx.execute(
    sql`SELECT id FROM memberships WHERE company_id=${companyId} ORDER BY id FOR UPDATE`,
  );
  return true;
}

/**
 * يحل منح resolve:attendance:branch على فرع الاستثناء نفسه.
 *
 * @param tx المعاملة الحالية
 * @param companyId الشركة
 * @param userId الفاعل المثبت
 * @param businessId النشاط المحلول من المسار
 * @param branchId فرع الاستثناء المقروء للفحص الأولي أو لإعادة التحقق بعد الأقفال
 * @param now لحظة الساعة المحقونة لسريان العضوية
 * @returns هل الفرع داخل منح الفاعل
 */
export async function readAttendanceExceptionAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
  now: Date,
): Promise<boolean> {
  const access = await readAccessTransaction(tx, companyId, userId, now);
  return evaluateAccess(access.grants, 'resolve:attendance:branch', {
    companyId,
    businessId,
    branchId,
    actorUserId: userId,
  });
}
