import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';
import { personalMemberships } from './personal-membership.ts';

/** يثبت الشركة والعضويات ثم الجهاز قبل كتابة الحضور؛ الإلغاء المتزامن لا يتجاوز إعادة الفحص.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة الموثقة
 * @param userId عامل الاستقبال
 * @param branchId فرع الجهاز
 * @param deviceId الجهاز الموثق
 * @returns موعد انتهاء الجهاز النشط، أو null إن لم يعد صالحاً
 */
export async function lockAttendanceDeviceContext(
  tx: Tx,
  companyId: string,
  userId: string,
  branchId: string,
  deviceId: string,
) {
  await personalMemberships(tx, companyId, userId, true, null);
  const [device] = await tx.execute<{ token_expires_at: Date }>(sql`
    SELECT token_expires_at FROM devices WHERE company_id=${companyId} AND id=${deviceId}
      AND branch_id=${branchId} AND status='ACTIVE' AND token_hash IS NOT NULL FOR SHARE`);
  return device === undefined ? null : new Date(device.token_expires_at);
}

/**
 * يقيّم إذن الحضور بالكارت للعامل على فرع الجهاز المثبّت، بنفس قارئ الوصول المستخدم في الحُرّاس.
 *
 * @param tx معاملة الشركة الموثقة
 * @param companyId الشركة
 * @param userId العامل صاحب جلسة الجهاز
 * @param businessId النشاط المحلول من الجهاز
 * @param branchId فرع الجهاز
 * @param at لحظة الساعة المحقونة، حتى لا يعتمد القرار على ساعة القاعدة
 * @returns هل يغطي منح فعّال الفرع المطلوب
 */
export async function readAttendanceDeviceAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
  at: Date,
): Promise<boolean> {
  const access = await readAccessTransaction(tx, companyId, userId, at);
  const memberships = await personalMemberships(tx, companyId, userId, false, at);
  const target = {
    companyId,
    businessId,
    branchId,
  };
  return (
    memberships.length > 0 &&
    evaluateAccess(access.grants, 'login:staff:branch', target) &&
    evaluateAccess(access.grants, 'clock:attendance:branch', target)
  );
}
