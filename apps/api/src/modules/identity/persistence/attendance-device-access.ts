import type { Tx } from '@pospay/db';

import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';

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
  return evaluateAccess(access.grants, 'clock:attendance:branch', {
    companyId,
    businessId,
    branchId,
  });
}
