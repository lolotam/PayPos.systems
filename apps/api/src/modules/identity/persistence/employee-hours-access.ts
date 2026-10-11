import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';
import { readFeatureEnabled } from './feature-reader.ts';

/**
 * يقفل الشركة ثم العضويات بنفس ترتيب محرر الصلاحيات حتى لا يسبق الحفظ سحب الإذن.
 *
 * @param tx معاملة الدوام
 * @param companyId الشركة المتحقق منها
 * @returns اكتمال الأقفال
 */
export async function lockEmployeeHoursAccess(tx: Tx, companyId: string): Promise<void> {
  await tx.execute(sql`SELECT id FROM companies WHERE id=${companyId} AND deleted_at IS NULL FOR NO KEY UPDATE`);
  await tx.execute(sql`SELECT id FROM memberships WHERE company_id=${companyId} ORDER BY id FOR UPDATE`);
}

/**
 * يعيد إذن إدارة الدوام للبشر من العضويات الحية؛ المنع يغلب المنح والميزة تفحص بعد الإذن.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة
 * @param userId المستخدم
 * @param businessId نشاط الموظفة
 * @param branchIds الفروع المحفوظة لتطبيق المنع الضيق
 * @returns إذن الإدارة وحالة الميزة
 */
export async function readEmployeeHoursAccess(tx: Tx, companyId: string, userId: string,
  businessId: string, branchIds: readonly string[] = []) {
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (!time) return { manage: false, featureEnabled: false };
  const access = await readAccessTransaction(tx, companyId, userId, new Date(time.at));
  const targets = branchIds.length ? branchIds.map((branchId) => ({ companyId, businessId, branchId })) : [{ companyId, businessId }];
  const manage = targets.every((target) => evaluateAccess(access.grants, 'manage:employee-hours:business', target));
  return { manage, featureEnabled: manage && await readFeatureEnabled(tx, companyId, 'staff') };
}
