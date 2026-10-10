import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';
import { readFeatureEnabled } from './feature-reader.ts';

/**
 * يثبت صلاحية الجداول والميزة في المجال المطلوب؛ قفل الكتابة يحتفظ بأقفال PR 7 حتى التدقيق.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة المتحقق منها
 * @param userId الفاعل
 * @param target المجال المطلوب بعد حل تبعية الفرع
 * @param target.businessId النشاط
 * @param target.branchId الفرع أو null للقوالب
 * @param target.action قراءة الجداول أو إدارتها أو إدارة إعداد الورديات للنشاط
 * @param lock تثبيت الشركة والعضويات للكتابة
 * @returns السماح أو سبب رفض دون كشف بيانات عضويات
 */
export async function scheduleAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  target: { businessId: string; branchId: string | null; action: 'read' | 'manage' | 'settings' },
  lock = false,
): Promise<'ALLOWED' | 'DENIED' | 'FEATURE_DISABLED'> {
  if (lock) {
    const [company] = await tx.execute(
      sql`SELECT id FROM companies WHERE id=${companyId} AND deleted_at IS NULL FOR NO KEY UPDATE`,
    );
    if (!company) return 'DENIED';
    await tx.execute(
      sql`SELECT id FROM memberships WHERE company_id=${companyId} ORDER BY id FOR UPDATE`,
    );
  }
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (!time) return 'DENIED';
  const access = await readAccessTransaction(tx, companyId, userId, new Date(time.at));
  const permission =
    target.action === 'settings'
      ? 'manage:schedule-settings:business'
      : `${target.action}:schedules:${target.branchId === null ? 'business' : 'branch'}`;
  if (
    !evaluateAccess(access.grants, permission, {
      companyId,
      businessId: target.businessId,
      ...(target.branchId === null ? {} : { branchId: target.branchId }),
    })
  )
    return 'DENIED';
  return (await readFeatureEnabled(tx, companyId, 'staff')) ? 'ALLOWED' : 'FEATURE_DISABLED';
}
