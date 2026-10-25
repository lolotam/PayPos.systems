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

/** الاشتراك الجديد بيتشال: المتصفح مينفعش يفضل مسجل من غير حد يطلبه. */
export async function dropSubscription(): Promise<void> {
  await unsubscribePush().catch(() => undefined);
}
