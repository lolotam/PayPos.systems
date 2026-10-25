import type { PushConfig } from '@pospay/contracts';

import { checkSession, identityOf } from './push-session-binding';
import { suspendPushForSignIn } from './push-sign-in-check';

/** نتيجة الفحص قبل أي تغيير: ولا حاجة، أو اختلاف مؤكد بيمنع التغيير. */
export type RefreshSessionAbort = { kind: 'none' } | { kind: 'session-changed' };

/**
 * بيعلّق السجل فور اختلاف مؤكد في شخص الجلسة أو شركتها، عشان النص القديم ما يفضلش
 * ظاهر لحد ما الواجهة تعيد القراءة. فشل التعليق نفسه بيمشي على التنظيف المقفل الموجود.
 *
 * @returns نتيجة تمنع التحديث وتطلب من الواجهة قراءة هوية الجلسة الجديدة
 */
export async function suspendChangedSession(): Promise<{ kind: 'session-changed' }> {
  await suspendPushForSignIn();
  return { kind: 'session-changed' };
}

/**
 * بيمنع رجوع سجل معلّق أو تبديل الاشتراك قبل تأكيد الجلسة؛ الحالة المجهولة توقف بلا
 * تغيير، والاختلاف المؤكد يعلّق السجل في نفس الخطوة.
 *
 * @param config إعدادات الجلسة اللي بدأ بيها التحديث الحالي
 * @returns سبب الإيقاف، أو null لما الشخص والشركة يطابقوا ويسمحوا بالتغيير
 */
export async function checkBeforeMutation(config: PushConfig): Promise<RefreshSessionAbort | null> {
  const session = await checkSession(identityOf(config));
  if (session === 'unknown') return { kind: 'none' };
  if (session === 'mismatch') return suspendChangedSession();
  return null;
}
