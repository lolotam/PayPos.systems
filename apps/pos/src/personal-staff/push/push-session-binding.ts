import type { PushConfig } from '@pospay/contracts';

import { pushCalls, withAbortTimeout } from './push-calls';

const CONFIG_TIMEOUT_MS = 8000;

/**
 * هوية الجلسة اللي السيرفر بيربط بيها التسجيل: الشخص والشركة مع بعض.
 * مرجع الشخص لوحده مش كفاية: نفس الموظفة ليها نفس المرجع في كل الشركات.
 */
export interface SessionIdentity {
  subscriber_ref: string;
  company_id: string;
}

/**
 * نتيجة فحص الجلسة: تطابق، أو شخص تاني (اختلاف مؤكد)، أو نفس الشخص في شركة تانية،
 * أو قراءة ما اتأكدتش. نفس الشخص في شركة تانية مش اختلاف بيعلّق السجل (FR-018، WP-Q4):
 * مفيش تعليق ولا مسح ولا PUT. والمجهول كمان: فشل الشبكة ما بيعملش تعليق ولا مسح ولا PUT.
 */
export type SessionCheck = 'match' | 'mismatch' | 'other-company' | 'unknown';

/**
 * بيقرأ إعدادات الإشعارات بجلسة الطلب الحالية، لأن السيرفر بيربط تسجيل PUT بشخص الجلسة
 * وشركتها مش بصاحب الاشتراك القديم. أي فشل أو مهلة أو خدمة مش جاهزة بيبقى حالة مجهولة
 * تمنع التسجيل من غير ما تتحسب اختلاف مؤكد.
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
 * بيستخرج هوية الجلسة من الإعدادات، لأن مرجع الشخص لوحده بيسمح بخلط شركتين لنفس الموظفة.
 *
 * @param config إعدادات الجلسة اللي رجعت من الـ API
 * @returns مرجع الشخص وشركة الجلسة اللي لازم يتطابقوا قبل التسجيل
 */
export function identityOf(config: PushConfig): SessionIdentity {
  return { subscriber_ref: config.subscriber_ref, company_id: config.company_id };
}

/**
 * بيقارن شخص الجلسة الحالية وشركتها بالهوية المتوقعة قبل التسجيل. الشخص بيتقارن الأول،
 * عشان النتيجة ماتعتمدش على توقيت الكاش. القراءة المجهولة مش مطابقة ومش اختلاف مؤكد،
 * عشان فشل الشبكة ما يعملش تعليق أو مسح ولا يسمح بـ PUT.
 *
 * @param expected مرجع الشخص والشركة المطلوب تأكيدهم
 * @returns match للتطابق الكامل، mismatch لشخص تاني، other-company لنفس الشخص في شركة
 * تانية، unknown لما القراءة ما تكتملش
 */
export async function checkSession(expected: SessionIdentity): Promise<SessionCheck> {
  const config = await fetchSessionConfig();
  if (config === null) return 'unknown';
  const current = identityOf(config);
  if (current.subscriber_ref !== expected.subscriber_ref) return 'mismatch';
  if (current.company_id !== expected.company_id) return 'other-company';
  return 'match';
}
