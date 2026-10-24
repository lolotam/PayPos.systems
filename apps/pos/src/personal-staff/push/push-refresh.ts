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
import { currentPushGeneration, runPushExclusive } from './push-lock';
import { notifyPushRecordChanged } from './push-record-events';
import { pushRecordStore } from './push-record-idb';
import type { PushRecord } from './push-record';

const API_TIMEOUT_MS = 10_000;
const SUBSCRIBE_TIMEOUT_MS = 15_000;
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
    const generation = currentPushGeneration();
    const record = await pushRecordStore.read().catch(() => null);
    if (record === null) return { kind: 'none' };
    if (record.company_id !== input.companyId) return { kind: 'none' };
    // المقارنة بتتم قبل أي حاجة: مرجع تاني جواب مؤكد إن الجهاز بقى لحد تاني،
    // فبنشيل الاشتراك والسجل من غير أي PUT (ADR-0052 §7).
    if (input.config.subscriber_ref !== record.subscriber_ref) {
      await unsubscribePush().catch(() => undefined);
      await removeRecord();
      return { kind: 'cleared' };
    }
    const live = record.suspended ? await resume(record, generation) : record;
    if (live === null) return { kind: 'none' };
    if (notificationPermission() !== 'granted') return { kind: 'none' };
    if (input.installationId === null) return { kind: 'none' };
    if (input.config.vapid_key_id !== live.vapid_key_id) {
      return rotate(input, live, input.installationId, generation);
    }
    const subscription = await currentSubscription();
    if (subscription === null) {
      await removeRecord();
      await revoke(input.installationId);
      return { kind: 'cleared' };
    }
    await withTimeout(
      pushCalls.register({
        installation_id: input.installationId,
        vapid_key_id: live.vapid_key_id,
        delivery_token: live.token,
        subscription: pushSubscriptionBody(subscription),
        locale: input.locale,
      }),
      API_TIMEOUT_MS,
    );
    return { kind: 'refreshed' };
  });
}

/**
 * سجل معلّق بعد فحص توقيع فاشل: نفس مرجع المشترك بيرجّعه قايم (ADR-0052 §7).
 *
 * @param record السجل المعلّق
 * @param generation جيل الشغل وقت ما بدأ
 * @returns السجل بعد الرجوع، أو null لما الجيل يتغير
 */
async function resume(record: PushRecord, generation: number): Promise<PushRecord | null> {
  if (generation !== currentPushGeneration()) return null;
  const live = { ...record, suspended: false };
  try {
    await pushRecordStore.write(live);
  } catch {
    return null;
  }
  notifyPushRecordChanged();
  return live;
}

async function rotate(
  input: PushRefreshInput,
  record: PushRecord,
  installationId: string,
  generation: number,
): Promise<PushRefreshOutcome> {
  // المتصفح ما بيقولش المفتاح اللي اتعمل بيه الاشتراك، فالتسجيل القديم بيتشال والتسجيل
  // الجديد بيتعمل بالمفتاح الجديد — وده مش متعلق بالسطر عند الـ API (ADR-0052 §2).
  const existing = await currentSubscription();
  if (existing !== null) await unsubscribePush();
  const subscription = await withTimeout(
    subscribePush(base64UrlToBytes(input.config.vapid_public_key)),
    SUBSCRIBE_TIMEOUT_MS,
  ).catch(() => null);
  if (subscription === null) {
    await removeRecord();
    return { kind: 'cleared' };
  }
  const token = crypto.randomUUID();
  try {
    await withTimeout(
      pushCalls.register({
        installation_id: installationId,
        vapid_key_id: input.config.vapid_key_id,
        delivery_token: token,
        subscription: pushSubscriptionBody(subscription),
        locale: input.locale,
      }),
      API_TIMEOUT_MS,
    );
  } catch {
    await unsubscribePush().catch(() => undefined);
    await removeRecord();
    return { kind: 'cleared' };
  }
  if (generation !== currentPushGeneration()) {
    await unsubscribePush().catch(() => undefined);
    await removeRecord();
    return { kind: 'cleared' };
  }
  try {
    await pushRecordStore.write({
      token,
      subscriber_ref: record.subscriber_ref,
      company_id: record.company_id,
      vapid_key_id: input.config.vapid_key_id,
      suspended: false,
    });
  } catch {
    // السيرفر ماسك توكن من غير سجل محلي: من غيره الـ service worker مش هيلاقيه أبداً.
    await unsubscribePush().catch(() => undefined);
    await revoke(installationId);
    await removeRecord();
    return { kind: 'cleared' };
  }
  notifyPushRecordChanged();
  return { kind: 'rotated', token };
}

async function removeRecord(): Promise<void> {
  await pushRecordStore.remove().catch(() => undefined);
  notifyPushRecordChanged();
}

async function revoke(installationId: string): Promise<void> {
  try {
    await withTimeout(pushCalls.revoke(installationId), REVOKE_TIMEOUT_MS);
  } catch {
    // المراجعة على السيرفر أفضل effort: السجل المحلي اتمسح والزر بيعرض مقفول.
  }
}
