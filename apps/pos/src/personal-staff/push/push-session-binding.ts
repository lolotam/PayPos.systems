import type { PushConfig } from '@pospay/contracts';

import { pushCalls, withAbortTimeout } from './push-calls';

const CONFIG_TIMEOUT_MS = 8000;

/**
 * بيقرأ إعدادات الإشعارات بجلسة الطلب الحالية، لأن السيرفر بيربط تسجيل PUT بشخص الجلسة
 * اللي بعته مش بصاحب الاشتراك القديم. أي فشل أو مهلة أو خدمة مش جاهزة بيبقى حالة مجهولة
 * تمنع التسجيل بدل ما يتبني قرار على بيانات قديمة.
 *
 * @returns الإعدادات الجاهزة للجلسة الحالية، أو null لما الهوية أو الجاهزية ما تتأكدش
 */
export async function fetchSessionConfig(): Promise<PushConfig | null> {
  try {
    const result = await withAbortTimeout((signal) => pushCalls.config(signal), CONFIG_TIMEOUT_MS);
    return result.kind === 'ready' ? result.config : null;
  } catch {
    return null;
  }
}

/**
 * بيتأكد إن الشخص اللي هيسجّل هو نفسه صاحب الإعدادات، لأن السيرفر بيربط PUT بشخص
 * الجلسة الحالية؛ أي قراءة فاشلة أو مرجع مختلف بيقفل التسجيل.
 *
 * @param subscriberRef مرجع المشترك اللي لازم تطابقه الجلسة الحالية
 * @returns true بس لما إعدادات الجلسة الحالية تؤكد نفس المرجع
 */
export async function sessionStillMatches(subscriberRef: string): Promise<boolean> {
  const config = await fetchSessionConfig();
  return config?.subscriber_ref === subscriberRef;
}
