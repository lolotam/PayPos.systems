import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { pushCalls } from './push-calls';
import {
  bumpGeneration,
  createCrossTabModel,
  createHold,
  currentSubscription,
  generation,
  pushSubscriptionBody,
  readRecord,
  registerOnServer,
  removeIfMatches,
  removeRecord,
  revokeOnServer,
  stubWebLocks,
  subscribeWithDeadline,
  suspendRecord,
  unsubscribePush,
  writeIfGeneration,
  writeRecord,
  type BrowserSlot,
  type CrossTabModel,
} from './push-cross-tab-model';
import type { PushRecord, PushWriteOptions } from './push-record';
import { refreshPush } from './push-refresh';

const INSTALLATION = '12345678-1234-4234-8234-123456789abc';
const COMPANY = 'company-a';
const START = 'test-start-d';
const OLD_VAPID = 'oldkey0000000000';
const NEW_VAPID = '0123456789abcdef';

const RECORD: PushRecord = {
  token: START,
  subscriber_ref: 'subscriber-ref',
  company_id: COMPANY,
  vapid_key_id: OLD_VAPID,
  suspended: false,
  revision: 0,
};

// سجل محلّي: مفيش التزامن بين التبويبات هنا، فكل تبويب بيقفل على نسخته.
let model: CrossTabModel = createCrossTabModel();

vi.mock('./push-record-events', () => ({ notifyPushRecordChanged: vi.fn() }));

vi.mock('./push-record-idb', () => ({
  pushRecordStore: {
    read: () => readRecord(model),
    write: (record: PushRecord) => writeRecord(model, record),
    remove: () => removeRecord(model),
    removeIfMatches: (expected: { token: string | null; revision: number }) =>
      removeIfMatches(model, expected),
    suspend: () => suspendRecord(model),
    generation: () => generation(model),
    bumpGeneration: () => bumpGeneration(model),
    writeIfGeneration: (record: PushRecord, expected: number, options?: PushWriteOptions) =>
      writeIfGeneration(model, record, expected, options),
  },
}));

vi.mock('./push-browser', () => ({
  base64UrlToBytes: () => new Uint8Array([1, 2, 3]),
  currentSubscription: () => currentSubscription(model),
  notificationPermission: () => {
    model.permissionRequests += 1;
    return 'granted' as const;
  },
  pushSubscriptionBody: (subscription: BrowserSlot) => pushSubscriptionBody(subscription),
  requestNotificationPermission: async () => {
    model.permissionRequests += 1;
    return 'granted' as const;
  },
  subscribeWithDeadline: () => subscribeWithDeadline(model),
  unsubscribePush: () => unsubscribePush(model),
}));

vi.mock('./push-calls', () => ({
  pushCalls: { config: vi.fn(), register: vi.fn(), revoke: vi.fn() },
  PushKeyStaleError: class PushKeyStaleError extends Error {},
  withAbortTimeout: <T>(run: (signal: AbortSignal) => Promise<T>) =>
    run(new AbortController().signal),
}));

beforeEach(() => {
  vi.clearAllMocks();
  model = createCrossTabModel();
  // قفل Web Locks حقيقي: التحديث بيتسلسل مع أي شغل تاني على نفس الاسم.
  stubWebLocks(model);
  // السيرفر بيشتغل بمفتاح جديد: أي تسجيل بمفتاح قديم مرفوض.
  model.currentVapid = NEW_VAPID;
  vi.mocked(pushCalls.config).mockResolvedValue({
    kind: 'ready',
    config: {
      vapid_public_key: 'public-key',
      vapid_key_id: NEW_VAPID,
      subscriber_ref: 'subscriber-ref',
    },
  });
  vi.mocked(pushCalls.register).mockImplementation((body) => {
    const hold = model.holds.shift();
    // أي تسجيل بعد ده بيوصل السيرفر على طول؛ التسجيلات الأولانية محجوزة.
    if (hold === undefined) {
      try {
        registerOnServer(model, body);
      } catch (cause) {
        // السيرفر رفض التسجيل (مفتاح قديم): الرفض وعد مرفوض، مش خطأ في الاختبار.
        return Promise.reject(cause);
      }
      return Promise.resolve();
    }
    hold.body = body;
    hold.arrive();
    return hold.promise;
  });
  vi.mocked(pushCalls.revoke).mockImplementation((installationId) => {
    revokeOnServer(model, installationId);
    return Promise.resolve();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('drops the rotation registration when a sign in suspension takes the record', async () => {
  model.record = { ...RECORD };
  const hold = createHold(model);
  const rotation = refreshPush({
    companyId: COMPANY,
    locale: 'en',
    config: {
      vapid_public_key: 'public-key',
      vapid_key_id: NEW_VAPID,
      subscriber_ref: 'subscriber-ref',
    },
    installationId: INSTALLATION,
  });

  await hold.arrived;
  // تعليق دخول وقت ما التدوير كان بيسجل: السجل اتعلق بمراجعة أعلى.
  model.record = { ...RECORD, suspended: true, revision: 1 };
  model.caller = COMPANY;
  hold.land();
  hold.release();

  expect(await rotation).toEqual({ kind: 'cleared' });
  expect(model.slot).toBeNull();
  expect(model.rows.has(`${COMPANY}:${INSTALLATION}`)).toBe(false);
  expect(model.revokes).toEqual([INSTALLATION]);
  expect(model.record?.suspended).toBe(true);
  expect(model.record?.token).toBe(START);
});
