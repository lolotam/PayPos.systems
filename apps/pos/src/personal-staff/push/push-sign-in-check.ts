import { unsubscribePush } from './push-browser';
import { pushCalls, withAbortTimeout } from './push-calls';
import { runPushExclusive } from './push-lock';
import { notifyPushRecordChanged } from './push-record-events';
import { pushRecordStore } from './push-record-idb';
import type { PushSuspension } from './push-record';

const CONFIG_TIMEOUT_MS = 8000;

// رقم لكل تشغيل: جواب تشغيل قديم بيتجاهل، عشان ماينفعش جواب متأخر يغيّر قرار تشغيل أحدث (FR-018).
let sequence = 0;

/**
 * بيعلّق عرض نص الإشعارات قبل ما الجلسة الجديدة تتأسس: السجل بيتكتب معلق من غير انتظار
 * القفل، فأي إشعار متسرب للمشترك القديم ما بيعرفش نصه (FR-018).
 * التعليق مش بيكسر الجيل: تسجيل نفس الموظفة أثناء تدوير لازم يفضل محفوظ (ADR-0052 §7).
 * اللقطة اللي بنقارن بيها هي السجل اللي رجعته عملية التعليق نفسها، فمفيش سباق
 * بين القراءة والتعليق: لو السجل اتمسح قبل التعليق، التعليق بيرجع null ومفيش حاجة تتغير.
 */
export async function suspendPushForSignIn(): Promise<void> {
  let snapshot: PushSuspension | null;
  try {
    snapshot = await pushRecordStore.suspend();
  } catch {
    // من غير تعليق السجل بيفضل قايم مفتوح، فبنمسحه ونشيل الاشتراك (fail-closed).
    await pushRecordStore.remove().catch(() => undefined);
    await unsubscribePush().catch(() => undefined);
    notifyPushRecordChanged();
    return;
  }
  if (snapshot === null) return;
  notifyPushRecordChanged();
}

/**
 * فحص التوقيع وقت تسجيل الدخول الجديد: بيعلّق عرض النص الأول، وبعدين بيقارن مرجع المشترك.
 * المرجع المختلف جواب مؤكد فالسجل بيتمسح؛ الفشل أو الوقت الضائع بيسيب السجل معلّق (FR-018).
 * المقارنة بتتم على السجل اللي رجع من عملية التعليق نفسها: هو ده اللي اتعلق فعلاً، فأي
 * تسجيل تاني كسب السجل قبلها مايتقارنش بسجل قديم. والرجوع المحروس بيستعمل الجيل اللي
 * رجع مع التعليق، مش جيل مقروء قبله، عشان ما يفشلش رجوع صالح (ADR-0052 §7).
 */
export async function runSignInPushCheck(): Promise<void> {
  const run = (sequence += 1);
  await runPushExclusive(async (): Promise<void> => {
    let snapshot: PushSuspension | null;
    try {
      snapshot = await pushRecordStore.suspend();
    } catch {
      // من غير تعليق السجل بيفضل قايم مفتوح، فبنمسحه ونشيل الاشتراك (fail-closed).
      await pushRecordStore.remove().catch(() => undefined);
      await unsubscribePush().catch(() => undefined);
      notifyPushRecordChanged();
      return;
    }
    if (snapshot === null) return;
    const suspended = snapshot.record;
    notifyPushRecordChanged();
    let result: Awaited<ReturnType<typeof pushCalls.config>>;
    try {
      result = await withAbortTimeout((signal) => pushCalls.config(signal), CONFIG_TIMEOUT_MS);
    } catch {
      return;
    }
    if (run !== sequence) return;
    if (result.kind === 'not-ready') return;
    const current = await pushRecordStore.read().catch(() => null);
    // تسجيل أو تدوير أحدث عدّى وقت المقارنة: النسخة القديمة ماينفعش ترجع تاني،
    // لأن توكنها القديم كان هيخفي إشعارات صاحبها الحقيقيين (ADR-0052 §7).
    if (
      current === null ||
      current.token !== suspended.token ||
      current.subscriber_ref !== suspended.subscriber_ref
    ) {
      return;
    }
    if (result.config.subscriber_ref === suspended.subscriber_ref) {
      const written = await pushRecordStore
        .writeIfGeneration({ ...current, suspended: false }, snapshot.generation, {
          clearSuspension: true,
          expectRevision: suspended.revision,
          expectToken: suspended.token,
        })
        .catch(() => false);
      if (!written) return;
      notifyPushRecordChanged();
      return;
    }
    const removed = await pushRecordStore
      .removeIfMatches({ token: suspended.token, revision: suspended.revision })
      .catch(() => false);
    if (!removed) return;
    await unsubscribePush().catch(() => undefined);
    notifyPushRecordChanged();
  });
}
