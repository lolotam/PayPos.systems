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
  stubNoWebLocks,
  stubWebLocks,
  subscribeWithDeadline,
  suspendRecord,
  unsubscribePush,
  writeIfGeneration,
  writeRecord,
  type BrowserSlot,
  type CrossTabModel,
} from './push-cross-tab-model';
import { enablePush, type PushEnableInput } from './push-enable';
import type { PushRecord, PushWriteOptions } from './push-record';
import { refreshPush } from './push-refresh';

const INSTALLATION = '12345678-1234-4234-8234-123456789abc';
const COMPANY = 'company-a';
const PERSON_A = 'subscriber-a';
const PERSON_B = 'subscriber-b';
const EXISTING = 'test-existing-d';
const EXISTING_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/existing';

const CONFIG = {
  vapid_public_key: 'public-key',
  vapid_key_id: '0123456789abcdef',
  subscriber_ref: 'subscriber-ref',
};

const RECORD: PushRecord = {
  token: EXISTING,
  subscriber_ref: 'subscriber-ref',
  company_id: COMPANY,
  vapid_key_id: '0123456789abcdef',
  suspended: true,
  revision: 3,
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

function input(onRegistered: (token: string) => void, companyId = COMPANY): PushEnableInput {
  return { companyId, locale: 'en', installationId: INSTALLATION, onRegistered };
}

beforeEach(() => {
  vi.clearAllMocks();
  model = createCrossTabModel();
  // قفل Web Locks حقيقي: التشغيل والتحديث بيتسلسوا فعلاً عبر التبويبات.
  stubWebLocks(model);
  vi.mocked(pushCalls.config).mockResolvedValue({ kind: 'ready', config: CONFIG });
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

it('serializes two enables with the cross tab lock', async () => {
  let firstToken = '';
  let secondToken = '';
  const firstHold = createHold(model);
  const secondHold = createHold(model);
  const first = enablePush(input((token) => (firstToken = token)));
  const second = enablePush(input((token) => (secondToken = token)));

  await firstHold.arrived;
  // التبويب التاني مستني القفل: مفيش تسجيل تاني وصل الـ API.
  expect(vi.mocked(pushCalls.register)).toHaveBeenCalledTimes(1);

  model.caller = COMPANY;
  firstHold.land();
  firstHold.release();
  expect(await first).toEqual({ kind: 'enabled', token: firstToken });

  await secondHold.arrived;
  secondHold.land();
  secondHold.release();
  expect(await second).toEqual({ kind: 'enabled', token: secondToken });

  const row = model.rows.get(`${COMPANY}:${INSTALLATION}`);
  expect(row?.token).toBe(secondToken);
  expect(model.record?.token).toBe(secondToken);
  expect(row?.endpoint).toBe(model.slot?.endpoint);
  expect(model.slot).not.toBeNull();
  expect(model.revokes).toEqual([]);
});

it('lets the second person of the same company take the record', async () => {
  // الإجابة الأولى للـ config تخص التبويب الأول، والتانية تخص التبويب التاني.
  vi.mocked(pushCalls.config)
    .mockResolvedValueOnce({ kind: 'ready', config: { ...CONFIG, subscriber_ref: PERSON_A } })
    .mockResolvedValueOnce({ kind: 'ready', config: { ...CONFIG, subscriber_ref: PERSON_B } });
  let personAToken = '';
  let personBToken = '';
  const personAHold = createHold(model);
  const personBHold = createHold(model);
  const personA = enablePush(input((token) => (personAToken = token)));
  const personB = enablePush(input((token) => (personBToken = token)));

  await personAHold.arrived;
  model.caller = COMPANY;
  model.callerRef = PERSON_A;
  personAHold.land();
  personAHold.release();
  expect(await personA).toEqual({ kind: 'enabled', token: personAToken });

  await personBHold.arrived;
  model.callerRef = PERSON_B;
  personBHold.land();
  personBHold.release();
  expect(await personB).toEqual({ kind: 'enabled', token: personBToken });

  const row = model.rows.get(`${COMPANY}:${INSTALLATION}`);
  expect(row?.subscriber).toBe(PERSON_B);
  expect(model.record?.subscriber_ref).toBe(PERSON_B);
  expect(row?.token).toBe(personBToken);
  expect(model.record?.token).toBe(personBToken);
  expect(model.slot).not.toBeNull();
});

it('tears the registration down when the record is removed while it registers', async () => {
  const hold = createHold(model);
  const tab = enablePush(input(() => undefined));

  await hold.arrived;
  // خروج في تبويب تاني كسر الجيل ومسح السجل أثناء تسجيلنا.
  model.generation += 1;
  model.record = null;
  model.caller = COMPANY;
  hold.land();
  hold.release();

  expect(await tab).toEqual({ kind: 'failed' });
  expect(model.rows.has(`${COMPANY}:${INSTALLATION}`)).toBe(false);
  expect(model.slot).toBeNull();
});

it('refuses to enable and to refresh without a cross tab lock', async () => {
  stubNoWebLocks();
  // سجل قايم واشتراك موجود وسطر على السيرفر: من غير القفل لازم كل ده يفضل زي ما هو.
  model.record = { ...RECORD };
  model.slot = { endpoint: EXISTING_ENDPOINT };
  model.caller = COMPANY;
  registerOnServer(model, {
    installation_id: INSTALLATION,
    vapid_key_id: CONFIG.vapid_key_id,
    delivery_token: EXISTING,
    subscription: {
      endpoint: EXISTING_ENDPOINT,
      expirationTime: null,
      keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
    },
    locale: 'en',
  });
  const record = { ...model.record };
  const row = { ...model.rows.get(`${COMPANY}:${INSTALLATION}`) };

  const outcome = await enablePush(input(() => undefined));
  const refreshed = await refreshPush({
    companyId: COMPANY,
    locale: 'en',
    config: CONFIG,
    installationId: INSTALLATION,
  });

  expect(outcome).toEqual({ kind: 'failed' });
  expect(refreshed).toEqual({ kind: 'none' });
  expect(model.record).toEqual(record);
  expect(model.slot?.endpoint).toBe(EXISTING_ENDPOINT);
  expect(model.rows.get(`${COMPANY}:${INSTALLATION}`)).toEqual(row);
  expect(model.permissionRequests).toBe(0);
  expect(model.subscribes).toBe(0);
  expect(model.revokes).toEqual([]);
  expect(vi.mocked(pushCalls.register)).not.toHaveBeenCalled();
  expect(vi.mocked(pushCalls.revoke)).not.toHaveBeenCalled();
});
