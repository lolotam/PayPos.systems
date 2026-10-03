import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';
import { readFeatureEnabled } from './feature-reader.ts';

/**
 * يثبت أقفال الصلاحيات قبل قفل الموظف، بنفس ترتيب محرر الصلاحيات لمنع سباق سحب الإذن.
 *
 * @param tx معاملة كتابة الراتب
 * @param companyId الشركة المتحقق منها
 * @returns اكتمال الأقفال دون تعديل أي عضوية
 */
export async function lockEmployeeSalaryAccess(tx: Tx, companyId: string): Promise<void> {
  await tx.execute(
    sql`SELECT id FROM companies WHERE id=${companyId} AND deleted_at IS NULL FOR NO KEY UPDATE`,
  );
  await tx.execute(
    sql`SELECT id FROM memberships WHERE company_id=${companyId} ORDER BY id FOR UPDATE`,
  );
}

/**
 * يقيم قراءة وإدارة الراتب في كل نطاق محفوظ بعد انتظار الأقفال؛ المنع يسبق أي كشف للسجل.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة المتحقق منها
 * @param userId القارئ أو المعدل
 * @param businessId نشاط الموظف المحفوظ
 * @param branchIds الفروع الأساسية والمفتوحة المحفوظة
 * @returns صلاحيات الراتب وحالة الميزة للقارئ المسموح فقط
 */
export async function readEmployeeSalaryAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchIds: readonly string[],
) {
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) return { read: false, manage: false, featureEnabled: false };
  const access = await readAccessTransaction(tx, companyId, userId, new Date(time.at));
  const allowed = (permission: string) =>
    branchIds.length > 0 &&
    branchIds.every((branchId) =>
      evaluateAccess(access.grants, permission, { companyId, businessId, branchId }),
    );
  const read = allowed('read:salaries:business');
  // TODO(spec): SS-Q1 إدارة بلا قراءة: نطلب الإذنين حتى لا يكشف رد الكتابة وجود الراتب؛ نوصي بمنحهما معاً.
  return {
    read,
    manage: read && allowed('manage:salaries:business'),
    featureEnabled: read && (await readFeatureEnabled(tx, companyId, 'staff')),
  };
}
