import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';
import { readFeatureEnabled } from './feature-reader.ts';

/**
 * يفحص إذن الموافقة على الخصم في كل صفحة من قائمة الموافقين؛ إذن التسجيل لا يفتح قائمة الموافقين.
 *
 * @param tx معاملة الشركة للقائمة
 * @param companyId الشركة المتحقق منها
 * @param userId مستخدمة حساب admin
 * @param businessId النشاط المثبت عبر tenancy
 * @param branchId الفرع المطلوب
 * @returns الإذن الحالي والميزة بعد مراعاة المنع وانتهاء المنح
 */
export async function readDiscountApprovalListAccess(tx: Tx, companyId: string, userId: string, businessId: string, branchId: string): Promise<'ALLOWED' | 'DENIED' | 'FEATURE_DISABLED'> {
  const [clock] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (!clock) return 'DENIED';
  const at = new Date(clock.at);
  const access = await readAccessTransaction(tx, companyId, userId, at);
  if (!evaluateAccess(access.grants, 'approve:discounts:branch', { companyId, businessId, branchId })) return 'DENIED';
  return await readFeatureEnabled(tx, companyId, 'orders', at) ? 'ALLOWED' : 'FEATURE_DISABLED';
}
