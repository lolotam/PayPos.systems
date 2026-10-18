import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { evaluateAccess, type AccessGrant } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';
import { readFeatureEnabled } from './feature-reader.ts';

const PERMISSION = 'manage:employee-number:company';

/**
 * يقفل الشركة ثم كل العضويات بترتيب المعرف حتى لا يُسحب الإذن أثناء تعديل الرقم.
 *
 * @param tx معاملة تعديل الرقم
 * @param companyId الشركة المتحقق منها
 * @returns اكتمال الأقفال
 */
export async function lockEmployeeNumberAccess(tx: Tx, companyId: string): Promise<void> {
  await tx.execute(sql`SELECT id FROM companies WHERE id=${companyId} AND deleted_at IS NULL FOR NO KEY UPDATE`);
  await tx.execute(sql`SELECT id FROM memberships WHERE company_id=${companyId} ORDER BY id FOR UPDATE`);
}

/**
 * يعيد رفض الصلاحية أو الميزة على نشاط الموظفة وكل فرع حالي؛ منع واحد على أي منها يكفي.
 * الأهداف تأتي من صف الموظفة لا من الطلب، ووقت القرار هو وقت المعاملة.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة
 * @param userId المستخدم
 * @param businessId نشاط الموظفة المحفوظ
 * @param branchIds الفروع الحالية بما فيها الفرع الرئيسي
 * @returns FORBIDDEN أو FEATURE_DISABLED أو null عند السماح
 */
export async function readEmployeeNumberAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchIds: readonly string[],
): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null> {
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (!time) return 'FORBIDDEN';
  const at = new Date(time.at);
  const access = await readAccessTransaction(tx, companyId, userId, at);
  if (!numberAllowed(access.grants, companyId, businessId, branchIds)) return 'FORBIDDEN';
  return (await readFeatureEnabled(tx, companyId, 'staff', at)) ? null : 'FEATURE_DISABLED';
}

function numberAllowed(
  grants: readonly AccessGrant[],
  companyId: string,
  businessId: string,
  branchIds: readonly string[],
): boolean {
  const business = { companyId, businessId };
  if (!evaluateAccess(grants, PERMISSION, business)) return false;
  return branchIds.every((branchId) => evaluateAccess(grants, PERMISSION, { ...business, branchId }));
}

/**
 * يعيد رفض صلاحية بداية الترقيم أو ميزة الموظفين على الشركة وحدها.
 * الإعداد شركة واحدة بلا نشاط، فمنع نشاط أو فرع لا يغطي هذا الهدف ولا يمنع الضبط.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة
 * @param userId المستخدم
 * @returns FORBIDDEN أو FEATURE_DISABLED أو null عند السماح
 */
export async function readEmployeeNumberCompanyAccess(
  tx: Tx,
  companyId: string,
  userId: string,
): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null> {
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (!time) return 'FORBIDDEN';
  const at = new Date(time.at);
  const access = await readAccessTransaction(tx, companyId, userId, at);
  if (!evaluateAccess(access.grants, PERMISSION, { companyId })) return 'FORBIDDEN';
  return (await readFeatureEnabled(tx, companyId, 'staff', at)) ? null : 'FEATURE_DISABLED';
}
