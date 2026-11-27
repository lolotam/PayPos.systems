import { unsubscribePush } from './push-browser';
import { pushCalls, withAbortTimeout } from './push-calls';
import { notifyPushRecordChanged } from './push-record-events';
import { pushRecordStore } from './push-record-idb';
import type { PushRecord } from './push-record';

const REVOKE_TIMEOUT_MS = 5000;

/**
 * سجل معلّق بعد فحص توقيع فاشل: نفس مرجع المشترك بيرجّعه قايم (ADR-0052 §7).
 *
 * @param record السجل المعلّق
 * @param generation جيل السجل وقت ما الشغل بدأ
 * @returns السجل بعد الرجوع، أو null لما الجيل أو المراجعة أو التوكن يتغير
 */
export async function resumeRecord(
  record: PushRecord,
  generation: number,
): Promise<PushRecord | null> {
  const live = { ...record, suspended: false };
  try {
    const written = await pushRecordStore.writeIfGeneration(live, generation, {
      clearSuspension: true,
      expectRevision: record.revision,
      expectToken: record.token,
    });
    if (!written) return null;
  } catch {
    return null;
  }
  notifyPushRecordChanged();
  return live;
}

/** السجل المحلي بيتمسح والزر بيعرف إن الإشعارات اتقفلت. */
export async function removeRecord(): Promise<void> {
  await pushRecordStore.remove().catch(() => undefined);
  notifyPushRecordChanged();
}

/** السطر عند الـ API بيراجع: السطر مش هيلاقي حد يطلبه بعد ما السجل اتمسح. */
export async function revoke(installationId: string): Promise<void> {
  try {
    await withAbortTimeout((signal) => pushCalls.revoke(installationId, signal), REVOKE_TIMEOUT_MS);
  } catch {
    // المراجعة على السيرفر أفضل effort: السجل المحلي اتمسح والزر بيعرض مقفول.
  }
}

/**
 * الاشتراك الجديد بيتشال: المتصفح مينفعش يفضل مسجل من غير حد يطلبه. الاشتراك مشترك بين كل
 * التبويبات، فبنعلن التغيير عشان تبويب تاني ما يفضلش يعرض «شغال» (ADR-0052 §7).
 */
export async function dropSubscription(): Promise<void> {
  await unsubscribePush().catch(() => undefined);
  notifyPushRecordChanged();
}

/**
 * اشتراك المتصفح اتشال وسجل صاحب الجلسة الحالية لسه بيقول عليه «شغال»: السجل بيتمسح بس لو
 * لسه هو نفسه (نفس التوكن) وصاحبه هو صاحب الجلسة، فسجل تبويب تاني كسب الاشتراك أو سجل شخص
 * تاني معلّق ما يتلمسش. المخزن المجهول بيتساب زي ما هو.
 *
 * @param previous السجل اللي كان مخزن قبل تبديل الاشتراك
 * @param sessionOwner مرجع المشترك بتاع الجلسة الحالية
 */
export async function removeOrphanedRecord(
  previous: PushRecord | null,
  sessionOwner: string,
): Promise<void> {
  if (previous === null) return;
  try {
    const stored = await pushRecordStore.read();
    if (stored === null || stored.token !== previous.token) return;
    if (stored.subscriber_ref !== sessionOwner) return;
    const removed = await pushRecordStore.removeIfMatches({
      token: stored.token,
      revision: stored.revision,
    });
    if (removed) notifyPushRecordChanged();
  } catch {
    // حالة المخزن مجهولة: مفيش مسح.
  }
}

/**
 * كتابة السجل اتلغت والمتصفح أكد إنها ما اتحفظتش، فتسجيلنا (اشتراك المتصفح وسطره عند الـ API)
 * مالوش سجل محلي يقول عليه. بنشيله بس لو السجل المخزن لسه زي ما كان وقت البداية: سجل أحدث
 * معناه إن تبويب تاني كسب الاشتراك والسطر. القراءة الفاشلة بتسيب كل حاجة (حالة مجهولة).
 *
 * @param installationId معرف التثبيت اللي سطره عند الـ API بيتراجع
 * @param expected توكن ومراجعة السجل المخزن وقت بداية العملية
 * @returns true لما التسجيل اتشال، وfalse لما السجل اتغيّر أو القراءة فشلت فاتساب زي ما هو
 */
export async function teardownUnrecordedRegistration(
  installationId: string,
  expected: { token: string | null; revision: number },
): Promise<boolean> {
  let stored: PushRecord | null;
  try {
    stored = await pushRecordStore.read();
  } catch {
    return false;
  }
  if ((stored?.token ?? null) !== expected.token) return false;
  if ((stored?.revision ?? 0) !== expected.revision) return false;
  await dropSubscription();
  await revoke(installationId);
  return true;
}

/**
 * سجل قديم لسه زي ما كان بعد ما اشتراكه اتبدّل وسطره اتراجع: بيتمسح بنفس حراسة التوكن
 * والمراجعة، فالمخزن ما يفضلش بيقول «شغال» على اشتراك مش موجود. سجل أحدث أو مخزن مجهول بيتساب.
 *
 * @param expected توكن ومراجعة السجل القديم وقت بداية العملية
 */
export async function removeStaleRecord(expected: {
  token: string;
  revision: number;
}): Promise<void> {
  try {
    const removed = await pushRecordStore.removeIfMatches(expected);
    if (removed) notifyPushRecordChanged();
  } catch {
    // حالة المخزن مجهولة: مفيش مسح.
  }
}
