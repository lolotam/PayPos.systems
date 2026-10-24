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
  const stored = await pushRecordStore.read().catch(() => null);
  if (stored === null) return { kind: 'none' };
  if (stored.company_id !== input.companyId) return { kind: 'none' };
  if (stored.suspended && !(await resumeSuspended(input, stored))) {
    return { kind: 'cleared' };
  }
  const record = stored.suspended ? { ...stored, suspended: false } : stored;
  if (notificationPermission() !== 'granted') return { kind: 'none' };
  if (input.installationId === null) return { kind: 'none' };
  if (input.config.vapid_key_id !== record.vapid_key_id) {
    return rotate(input, record, input.installationId);
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
    vapid_key_id: record.vapid_key_id,
    delivery_token: record.token,
    subscription: pushSubscriptionBody(subscription),
    locale: input.locale,
  });
  return { kind: 'refreshed' };
}

/**
 * سجل معلّق بعد فحص توقيع فاشل: بنقارن مرجع المشترك بمرجع الجلسة.
 * نفس المرجع بيرجّع السجل، ومرجع تاني جواب مؤكد فالسجل بيتمسح والاشتراك بيتشال (ADR-0052 §7).
 *
 * @param input الجلسة الحالية
 * @param record السجل المعلّق
 * @returns true لما السجل يرجع قايم
 */
async function resumeSuspended(input: PushRefreshInput, record: PushRecord): Promise<boolean> {
  if (input.config.subscriber_ref === record.subscriber_ref) {
    await pushRecordStore.write({ ...record, suspended: false }).catch(() => undefined);
    notifyPushRecordChanged();
    return true;
  }
  await unsubscribePush().catch(() => undefined);
  await pushRecordStore.remove().catch(() => undefined);
  notifyPushRecordChanged();
  return false;
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
