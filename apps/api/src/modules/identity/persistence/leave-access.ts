import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';
import { readFeatureEnabled } from './feature-reader.ts';
/**
 * يثبت سلطة الإجازة قبل قفل الموظف بنفس ترتيب الشركة ثم العضويات المستخدم في PR 7/16.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة المثبتة
 * @returns يكتمل بعد الأقفال أو يرفض الشركة المغلقة
 */
export async function lockLeaveAccess(tx: Tx, companyId: string): Promise<boolean> {
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
 * يحل منح الإجازة لكل الفروع دفعة واحدة مع ملكية صريحة؛ لا يستمد الهوية من الدور أو الطلب.
 *
 * @param tx المعاملة الحالية
 * @param companyId الشركة
 * @param userId الفاعل المثبت
 * @param businessId النشاط المحلول من tenancy
 * @param branchIds الفروع الحقيقية في النشاط
 * @param now لحظة الساعة المحقونة المشتركة مع أهلية الموظف والفترة
 * @param subjectUserId رابط الموظف للذات، أو undefined للمدير
 * @returns فروع كل فعل مع حالة الميزة؛ DENY يغلب لغير المالك والذات تحتاج تطابق المستخدمين
 */
export async function readLeaveAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchIds: readonly string[],
  now: Date,
  subjectUserId?: string,
) {
  const access = await readAccessTransaction(tx, companyId, userId, now);
  const suffix = subjectUserId === undefined ? 'branch' : 'own';
  const target = (branchId: string) => ({
    companyId,
    businessId,
    branchId,
    actorUserId: userId,
    ...(subjectUserId === undefined ? {} : { subjectUserId }),
  });
  const branches = (action: string) =>
    branchIds.filter((id) =>
      evaluateAccess(access.grants, `${action}:leave:${suffix}`, target(id)),
    );
  return {
    read: branches('read'),
    create: branches('create'),
    cancel: branches('cancel'),
    featureEnabled: await readFeatureEnabled(tx, companyId, 'staff'),
  };
}
