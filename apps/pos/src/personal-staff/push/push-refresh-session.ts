import type { PushConfig } from '@pospay/contracts';

import type { PushRecord } from './push-record';
import { removeOrphanedRecord } from './push-refresh-record';
import { checkSession, fetchSessionConfig, identityOf } from './push-session-binding';
import { suspendPushForSignIn } from './push-sign-in-check';

/** نتيجة الفحص قبل أي تغيير: ولا حاجة، أو اختلاف مؤكد بيمنع التغيير. */
export type RefreshSessionAbort = { kind: 'none' } | { kind: 'session-changed' };

/**
 * بيعلّق السجل فور ما يتأكد إن الجلسة بقت لشخص تاني، عشان النص القديم ما يفضلش
 * ظاهر لحد ما الواجهة تعيد القراءة. فشل التعليق نفسه بيمشي على التنظيف المقفل الموجود.
 *
 * @param currentSubscriberRef مرجع شخص الجلسة الحالية: سجله هو ما بيتعلّقش، والقرار على
 * صاحب السجل المخزن مش على إعدادات اللي نادى
 * @returns نتيجة تمنع التحديث وتطلب من الواجهة قراءة هوية الجلسة الجديدة
 */
export async function suspendChangedSession(
  currentSubscriberRef: string,
): Promise<{ kind: 'session-changed' }> {
  await suspendPushForSignIn(currentSubscriberRef);
  return { kind: 'session-changed' };
}

/**
 * السيرفر رفض التسجيل لأن الجلسة اتبدّلت: صاحب السجل المخزن ما بقاش صاحب الجلسة. بنقرأ هوية
 * الجلسة الحالية عشان سجلها هو ما يتعلّقش؛ لو القراءة فشلت بنعلّق السجل من غير استثناء
 * (fail-closed)، والتحديث الجاي بيرجّعه لو صاحبه رجع. لما التسجيل بدأ بسجل قديم واشتراكه اتبدّل
 * قبل الرفض، سجل صاحب الجلسة الجديدة بيتشال لأنه بقى يتيم (بحراسة التوكن والمراجعة)، وسجل أي
 * شخص تاني بيفضل معلّق.
 *
 * @param orphanCandidate السجل القديم اللي اشتراكه اتبدّل قبل الرفض، أو null لما مفيش تبديل
 * @returns نتيجة تمنع التحديث وتطلب من الواجهة قراءة هوية الجلسة الجديدة
 */
export async function suspendAfterServerMismatch(
  orphanCandidate: PushRecord | null = null,
): Promise<{ kind: 'session-changed' }> {
  const current = await fetchSessionConfig();
  await suspendPushForSignIn(current?.subscriber_ref);
  if (current !== null) await removeOrphanedRecord(orphanCandidate, current.subscriber_ref);
  return { kind: 'session-changed' };
}

/**
 * بيمنع رجوع سجل معلّق أو تبديل الاشتراك قبل تأكيد الجلسة؛ الحالة المجهولة توقف بلا
 * تغيير، وشخص تاني يعلّق السجل في نفس الخطوة. نفس الشخص في شركة تانية بيوقف بلا تغيير
 * (FR-019): التحديث بيشتغل بس في جلسة الشركة اللي السجل بيقول عليها.
 *
 * @param config إعدادات الجلسة اللي بدأ بيها التحديث الحالي
 * @returns سبب الإيقاف، أو null لما الشخص والشركة يطابقوا ويسمحوا بالتغيير
 */
export async function checkBeforeMutation(config: PushConfig): Promise<RefreshSessionAbort | null> {
  const session = await checkSession(identityOf(config));
  if (session.kind === 'mismatch') return suspendChangedSession(session.current.subscriber_ref);
  if (session.kind !== 'match') return { kind: 'none' };
  return null;
}
