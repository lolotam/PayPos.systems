import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { pushCalls } from './push-calls';
import {
  bumpGeneration,
  createCrossTabModel,
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
const PERSON_A = 'subscriber-a';
const PERSON_B = 'subscriber-b';
const EXISTING = 'test-existing-d';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/existing';
const CONFIG = {
  vapid_public_key: 'public-key',
  vapid_key_id: '0123456789abcdef',
  subscriber_ref: PERSON_A,
  company_id: COMPANY,
};

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
  notificationPermission: () => 'granted' as const,
  pushSubscriptionBody: (subscription: BrowserSlot) => pushSubscriptionBody(subscription),
  subscribeWithDeadline: () => subscribeWithDeadline(model),
  unsubscribePush: () => unsubscribePush(model),
}));
vi.mock('./push-calls', () => ({
  pushCalls: { config: vi.fn(), register: vi.fn(), revoke: vi.fn() },
  withAbortTimeout: <T>(run: (signal: AbortSignal) => Promise<T>) =>
    run(new AbortController().signal),
}));

beforeEach(() => {
  vi.clearAllMocks();
  model = createCrossTabModel();
  stubWebLocks(model);
  vi.mocked(pushCalls.config).mockImplementation(async () => ({
    kind: 'ready',
    config: { ...CONFIG, subscriber_ref: model.callerRef },
  }));
  vi.mocked(pushCalls.register).mockImplementation(async (body) => {
    registerOnServer(model, body);
  });
  vi.mocked(pushCalls.revoke).mockImplementation(async (installationId) => {
    revokeOnServer(model, installationId);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('never registers the old person under the new shared-phone session', async () => {
  model.record = {
    token: EXISTING,
    subscriber_ref: PERSON_A,
    company_id: COMPANY,
    vapid_key_id: CONFIG.vapid_key_id,
    suspended: false,
    revision: 0,
  };
  model.slot = { endpoint: ENDPOINT };
  model.caller = COMPANY;
  model.callerRef = PERSON_A;
  registerOnServer(model, {
    installation_id: INSTALLATION,
    vapid_key_id: CONFIG.vapid_key_id,
    delivery_token: EXISTING,
    subscription: {
      endpoint: ENDPOINT,
      expirationTime: null,
      keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
    },
    locale: 'en',
  });
  const serverRow = { ...model.rows.get(`${COMPANY}:${INSTALLATION}`) };
  model.callerRef = PERSON_B;
  await suspendRecord(model);

  const stale = await refreshPush({
    companyId: COMPANY,
    locale: 'en',
    config: CONFIG,
    installationId: INSTALLATION,
  });

  // الشخص التاني اتأكد على فتح ناجح: سجل A (المعلّق) اتمسح، ومفيش PUT بتوكنه.
  expect(stale).toEqual({ kind: 'cleared' });
  expect(pushCalls.register).not.toHaveBeenCalled();
  expect(model.rows.get(`${COMPANY}:${INSTALLATION}`)).toEqual(serverRow);
  expect(model.record).toBeNull();

  const current = await refreshPush({
    companyId: COMPANY,
    locale: 'en',
    config: { ...CONFIG, subscriber_ref: PERSON_B },
    installationId: INSTALLATION,
  });

  expect(current).toEqual({ kind: 'none' });
  expect(model.record).toBeNull();
  expect(pushCalls.register).not.toHaveBeenCalled();
  expect(model.rows.get(`${COMPANY}:${INSTALLATION}`)).toEqual(serverRow);
});
