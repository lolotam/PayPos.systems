import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';
import { readFeatureEnabled } from './feature-reader.ts';

/** يثبت نفس ترتيب التسجيل: الشركة ثم العضويات المرتبة قبل أي موظف أو ربط.
 *
 * @param tx معاملة المدير داخل الشركة
 * @param companyId الشركة المتحقق منها
 * @returns وجود الشركة النشطة بعد القفل
 */
export async function lockPasskeyAccess(tx: Tx, companyId: string): Promise<boolean> {
  const rows = await tx.execute(
    sql`SELECT id FROM companies WHERE id=${companyId} AND deleted_at IS NULL FOR NO KEY UPDATE`,
  );
  if (rows.length !== 1) return false;
  await tx.execute(
    sql`SELECT id FROM memberships WHERE company_id=${companyId} ORDER BY id FOR SHARE`,
  );
  return true;
}

/** يحسب أذونات الربط الحية عند الفروع المحفوظة ويعطي الميزة فقط لقارئ مسموح.
 *
 * @param tx معاملة قراءة أو كتابة الشركة
 * @param companyId الشركة المتحقق منها
 * @param userId هوية المدير من الجلسة
 * @param businessId نشاط الموظف
 * @param branchIds الفروع المطلوب فحصها
 * @param now لحظة القرار المحقونة المشتركة مع الارتباطات وانتهاء تجاوز الميزة
 * @returns الفروع المقروءة والمسموح بفكها وحالة الميزة
 */
export async function readPasskeyAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchIds: readonly string[],
  now: Date,
) {
  const access = await readAccessTransaction(tx, companyId, userId, now);
  const allowed = (permission: string, branchId: string) =>
    evaluateAccess(access.grants, permission, { companyId, businessId, branchId });
  const readBranchIds = [...new Set(branchIds)].filter((branch) =>
    allowed('read:passkeys:branch', branch),
  );
  return {
    readBranchIds,
    unbindBranchIds: readBranchIds.filter((branch) => allowed('unbind:passkeys:branch', branch)),
    featureEnabled:
      readBranchIds.length > 0 && (await readFeatureEnabled(tx, companyId, 'staff', now)),
  };
}
