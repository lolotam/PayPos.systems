import { unsubscribePush } from './push-browser';
import { pushCalls, withAbortTimeout } from './push-calls';
import { runPushExclusive } from './push-lock';
import { notifyPushRecordChanged } from './push-record-events';
import { pushRecordStore } from './push-record-idb';

const CONFIG_TIMEOUT_MS = 8000;

// رقم لكل تشغيل: جواب تشغيل قديم بيتجاهل، عشان ماينفعش جواب متأخر يغيّر قرار تشغيل أحدث (FR-018).
let sequence = 0;

/**
 * بيعلّق عرض نص الإشعارات قبل ما الجلسة الجديدة تتأسس: السجل بيتكتب معلق من غير انتظار
 * القفل، فأي إشعار متسرب للمشترك القديم ما بيعرفش نصه (FR-018).
 * التعليق مش بيكسر الجيل: تسجيل نفس الموظفة أثناء تدوير لازم يفضل محفوظ (ADR-0052 §7).
 */
export async function suspendPushForSignIn(): Promise<void> {
  const record = await pushRecordStore.read().catch(() => null);
  if (record === null) return;
  try {
    await pushRecordStore.suspend();
  } catch {
    // من غير تعليق السجل بيفضل قايم مفتوح، فبنمسحه ونشيل الاشتراك (fail-closed).
    await pushRecordStore.remove().catch(() => undefined);
    await unsubscribePush().catch(() => undefined);
    notifyPushRecordChanged();
    return;
  }
  notifyPushRecordChanged();
}

/**
 * فحص التوقيع وقت تسجيل الدخول الجديد: بيعلّق عرض النص الأول، وبعدين بيقارن مرجع المشترك.
 * المرجع المختلف جواب مؤكد فالسجل بيتمسح؛ الفشل أو الوقت الضائع بيسيب السجل معلّق (FR-018).
 */
export async function runSignInPushCheck(): Promise<void> {
  const run = (sequence += 1);
  await runPushExclusive(async (): Promise<void> => {
    const generation = await pushRecordStore.generation();
    const record = await pushRecordStore.read().catch(() => null);
    if (record === null) return;
    let suspensionRevision: number;
    try {
      suspensionRevision = await pushRecordStore.suspend();
    } catch {
      // من غير تعليق السجل بيفضل قايم مفتوح، فبنمسحه ونشيل الاشتراك (fail-closed).
      await pushRecordStore.remove().catch(() => undefined);
      await unsubscribePush().catch(() => undefined);
      notifyPushRecordChanged();
      return;
    }
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
      current.token !== record.token ||
      current.subscriber_ref !== record.subscriber_ref
    ) {
      return;
    }
    if (result.config.subscriber_ref === record.subscriber_ref) {
      const written = await pushRecordStore
        .writeIfGeneration({ ...current, suspended: false }, generation, {
          clearSuspension: true,
          expectRevision: suspensionRevision,
          expectToken: record.token,
        })
        .catch(() => false);
      if (!written) return;
      notifyPushRecordChanged();
      return;
    }
    const removed = await pushRecordStore
      .removeIfMatches({ token: record.token, revision: suspensionRevision })
      .catch(() => false);
    if (!removed) return;
    await unsubscribePush().catch(() => undefined);
    notifyPushRecordChanged();
  });
}
