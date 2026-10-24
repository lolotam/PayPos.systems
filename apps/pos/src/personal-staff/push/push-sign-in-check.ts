import { unsubscribePush } from './push-browser';
import { pushCalls, withTimeout } from './push-calls';
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
  const record = await pushRecordStore.read().catch(() => null);
  if (record === null) return;
  await pushRecordStore.write({ ...record, suspended: true }).catch(() => undefined);
  let result: Awaited<ReturnType<typeof pushCalls.config>>;
  try {
    result = await withTimeout(pushCalls.config(), CONFIG_TIMEOUT_MS);
  } catch {
    return;
  }
  if (run !== sequence) return;
  if (result.kind === 'not-ready') return;
  if (result.config.subscriber_ref === record.subscriber_ref) {
    await pushRecordStore.write({ ...record, suspended: false }).catch(() => undefined);
    return;
  }
  await unsubscribePush().catch(() => undefined);
  await pushRecordStore.remove().catch(() => undefined);
}
