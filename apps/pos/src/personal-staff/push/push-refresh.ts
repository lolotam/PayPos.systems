import type { PushConfig } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';

import {
  base64UrlToBytes,
  currentSubscription,
  notificationPermission,
  pushSubscriptionBody,
  subscribePush,
  unsubscribePush,
} from './push-browser';
import { pushCalls, withTimeout } from './push-calls';
import { runPushExclusive } from './push-lock';
import { notifyPushRecordChanged } from './push-record-events';
import { pushRecordStore } from './push-record-idb';
import type { PushRecord } from './push-record';

const REVOKE_TIMEOUT_MS = 5000;

/** نتيجة التحديث وقت الفتح: ولا حاجة، أو تحديث عادي، أو إصلاح تدوير المفتاح، أو مسح السجل. */
export type PushRefreshOutcome =
  | { kind: 'none' }
  | { kind: 'refreshed' }
  | { kind: 'rotated'; token: string }
  | { kind: 'cleared' };

export interface PushRefreshInput {
  companyId: string;
  locale: Locale;
  config: PushConfig;
  installationId: string | null;
}

/**
 * بتحدّث الاشتراك وقت فتح التطبيق وبتصلّح تدوير مفتاح VAPID.
 * بتشتغل بس في جلسة الشركة اللي السجل بيقول عليها؛ في أي شركة تانية مفيش أي طلب (FR-019).
 *
 * @param input الشركة واللغة ومفتاح VAPID الحالي ومعرف التثبيت
 * @returns نتيجة التحديث
 */
export async function refreshPush(input: PushRefreshInput): Promise<PushRefreshOutcome> {
  return runPushExclusive(async (): Promise<PushRefreshOutcome> => {
    const record = await pushRecordStore.read().catch(() => null);
    if (record === null) return { kind: 'none' };
    if (record.company_id !== input.companyId) return { kind: 'none' };
    // المقارنة بتتم قبل أي حاجة: مرجع تاني جواب مؤكد إن الجهاز بقى لحد تاني،
    // فبنشيل الاشتراك والسجل من غير أي PUT (ADR-0052 §7).
    if (input.config.subscriber_ref !== record.subscriber_ref) {
      await unsubscribePush().catch(() => undefined);
      await pushRecordStore.remove().catch(() => undefined);
      notifyPushRecordChanged();
      return { kind: 'cleared' };
    }
    const live = record.suspended ? await resume(record) : record;
    if (notificationPermission() !== 'granted') return { kind: 'none' };
    if (input.installationId === null) return { kind: 'none' };
    if (input.config.vapid_key_id !== live.vapid_key_id) {
      return rotate(input, live, input.installationId);
    }
    const subscription = await currentSubscription();
    if (subscription === null) {
      await pushRecordStore.remove().catch(() => undefined);
      notifyPushRecordChanged();
      await revoke(input.installationId);
      return { kind: 'cleared' };
    }
    await pushCalls.register({
      installation_id: input.installationId,
      vapid_key_id: live.vapid_key_id,
      delivery_token: live.token,
      subscription: pushSubscriptionBody(subscription),
      locale: input.locale,
    });
    return { kind: 'refreshed' };
  });
}

/**
 * سجل معلّق بعد فحص توقيع فاشل: نفس مرجع المشترك بيرجّعه قايم (ADR-0052 §7).
 *
 * @param record السجل المعلّق
 * @returns السجل بعد الرجوع
 */
async function resume(record: PushRecord): Promise<PushRecord> {
  const live = { ...record, suspended: false };
  await pushRecordStore.write(live).catch(() => undefined);
  notifyPushRecordChanged();
  return live;
}

async function rotate(
  input: PushRefreshInput,
  record: PushRecord,
  installationId: string,
): Promise<PushRefreshOutcome> {
  // المتصفح ما بيقولش المفتاح اللي اتعمل بيه الاشتراك، فالتسجيل القديم بيتشال والتسجيل
  // الجديد بيتعمل بالمفتاح الجديد — وده مش متعلق بالسطر عند الـ API (ADR-0052 §2).
  const existing = await currentSubscription();
  if (existing !== null) await unsubscribePush();
  const subscription = await subscribePush(base64UrlToBytes(input.config.vapid_public_key));
  const token = crypto.randomUUID();
  await pushCalls.register({
    installation_id: installationId,
    vapid_key_id: input.config.vapid_key_id,
    delivery_token: token,
    subscription: pushSubscriptionBody(subscription),
    locale: input.locale,
  });
  await pushRecordStore.write({
    token,
    subscriber_ref: record.subscriber_ref,
    company_id: record.company_id,
    vapid_key_id: input.config.vapid_key_id,
    suspended: false,
  });
  notifyPushRecordChanged();
  return { kind: 'rotated', token };
}

async function revoke(installationId: string): Promise<void> {
  try {
    await withTimeout(pushCalls.revoke(installationId), REVOKE_TIMEOUT_MS);
  } catch {
    // المراجعة على السيرفر أفضل effort: السجل المحلي اتمسح والزر بيعرض مقفول.
  }
}
