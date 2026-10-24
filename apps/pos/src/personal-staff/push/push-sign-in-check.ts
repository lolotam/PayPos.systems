import { unsubscribePush } from './push-browser';
import { pushCalls, withTimeout } from './push-calls';
import { runPushExclusive } from './push-lock';
import { notifyPushRecordChanged } from './push-record-events';
import { pushRecordStore } from './push-record-idb';

const CONFIG_TIMEOUT_MS = 8000;

// رقم لكل تشغيل: جواب تشغيل قديم بيتجاهل، عشان ماينفعش جواب متأخر يغيّر قرار تشغيل أحدث (FR-018).
let sequence = 0;

/**
 * فحص التوقيع وقت تسجيل الدخول الجديد: بيعلّق عرض النص الأول، وبعدين بيقارن مرجع المشترك.
 * المرجع المختلف جواب مؤكد فالسجل بيتمسح؛ الفشل أو الوقت الضائع بيسيب السجل معلّق (FR-018).
 */
export async function runSignInPushCheck(): Promise<void> {
  const run = (sequence += 1);
  await runPushExclusive(async (): Promise<void> => {
    const record = await pushRecordStore.read().catch(() => null);
    if (record === null) return;
    try {
      await pushRecordStore.write({ ...record, suspended: true });
    } catch {
      // من غير تعليق السجل بيفضل قايم مفتوح، فبنمسحه (fail-closed) بدل ما نكمل (ADR-0052 §7).
      await pushRecordStore.remove().catch(() => undefined);
      notifyPushRecordChanged();
      return;
    }
    notifyPushRecordChanged();
    let result: Awaited<ReturnType<typeof pushCalls.config>>;
    try {
      result = await withTimeout(pushCalls.config(), CONFIG_TIMEOUT_MS);
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
      await pushRecordStore.write({ ...current, suspended: false }).catch(() => undefined);
      notifyPushRecordChanged();
      return;
    }
    await unsubscribePush().catch(() => undefined);
    await pushRecordStore.remove().catch(() => undefined);
    notifyPushRecordChanged();
  });
}
