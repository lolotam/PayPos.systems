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
 * يعيد إذن إدارة فروع الموظفة والفروع المسموحة للعرض من نفس العضويات الحية؛ المنع يغلب المنح.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة
 * @param userId المستخدم
 * @param businessId نشاط الموظفة
 * @param branchIds الفروع المحفوظة لتطبيق المنع الضيق
 * @param candidateBranchIds فروع العرض المرشحة ومنها الدوام المحفوظ بعد انتهاء الارتباط
 * @returns إذن إدارة الفروع المحفوظة وحالة الميزة وفروع العرض المسموحة
 */
export async function readEmployeeHoursAccess(tx: Tx, companyId: string, userId: string,
  businessId: string, branchIds: readonly string[] = [], candidateBranchIds: readonly string[] = branchIds) {
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (!time) return { manage: false, featureEnabled: false, allowedBranchIds: [] };
  const access = await readAccessTransaction(tx, companyId, userId, new Date(time.at));
  const targets = branchIds.length ? branchIds.map((branchId) => ({ companyId, businessId, branchId })) : [{ companyId, businessId }];
  const manage = targets.every((target) => evaluateAccess(access.grants, 'manage:employee-hours:business', target));
  const allowedBranchIds = [...new Set(candidateBranchIds)].filter((branchId) =>
    evaluateAccess(access.grants, 'manage:employee-hours:business', { companyId, businessId, branchId }));
  return { manage, featureEnabled: manage && await readFeatureEnabled(tx, companyId, 'staff'), allowedBranchIds };
}
