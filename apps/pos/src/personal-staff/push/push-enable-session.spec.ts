import { beforeEach, expect, it, vi } from 'vitest';
import type { PushConfig } from '@pospay/contracts';

import { unsubscribePush } from './push-browser';
import { pushCalls } from './push-calls';
import { enablePush } from './push-enable';
import { notifyPushRecordChanged } from './push-record-events';
import type { PushRecord } from './push-record';

const INSTALLATION = '12345678-1234-4234-8234-123456789abc';
const COMPANY = 'company-a';
const OTHER_COMPANY = 'company-b';
const PERSON = 'person-r';
const DELIVERY = 'test-delivery-a';

const fakes = vi.hoisted(() => ({
  record: null as PushRecord | null,
  subscribes: 0,
}));

const RECORD: PushRecord = {
  token: DELIVERY,
  subscriber_ref: PERSON,
  company_id: COMPANY,
  vapid_key_id: '0123456789abcdef',
  suspended: false,
  revision: 0,
};

const CONFIG: PushConfig = {
  vapid_public_key: 'public-key',
  vapid_key_id: '0123456789abcdef',
  subscriber_ref: PERSON,
  company_id: COMPANY,
};

vi.mock('./push-lock', () => ({
  hasCrossTabLock: () => true,
  runPushExclusive: <T>(work: () => Promise<T>) => work(),
}));

vi.mock('./push-record-events', () => ({ notifyPushRecordChanged: vi.fn() }));

vi.mock('./push-record-idb', () => ({
  pushRecordStore: {
    generation: async () => 0,
    read: async () => (fakes.record === null ? null : { ...fakes.record }),
    suspend: async () => {
      const stored = fakes.record;
      if (stored === null) return null;
      const suspended = { ...stored, suspended: true, revision: stored.revision + 1 };
      fakes.record = suspended;
      return { record: suspended, generation: 0 };
    },
    writeIfGeneration: async (record: PushRecord) => {
      fakes.record = record;
      return true;
    },
  },
}));

vi.mock('./push-browser', () => ({
  notificationPermission: () => 'granted' as const,
  requestNotificationPermission: async () => 'granted' as const,
  currentSubscription: async () => null,
  subscribeWithDeadline: async () => {
    fakes.subscribes += 1;
    return {
      endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
      unsubscribe: async () => true,
      toJSON: () => ({
        endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
        expirationTime: null,
        keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
      }),
    };
  },
  unsubscribePush: vi.fn(async () => true),
  base64UrlToBytes: () => new Uint8Array([1, 2, 3]),
  pushSubscriptionBody: () => ({
    endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
    expirationTime: null,
    keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
  }),
}));

vi.mock('./push-calls', () => ({
  pushCalls: { config: vi.fn(), register: vi.fn(), revoke: vi.fn() },
  PushKeyStaleError: class PushKeyStaleError extends Error {},
  withAbortTimeout: <T>(run: (signal: AbortSignal) => Promise<T>) =>
    run(new AbortController().signal),
}));

beforeEach(() => {
  vi.clearAllMocks();
  fakes.record = null;
  fakes.subscribes = 0;
  vi.mocked(pushCalls.config).mockResolvedValue({ kind: 'ready', config: CONFIG });
  vi.mocked(pushCalls.register).mockResolvedValue(undefined);
  vi.mocked(pushCalls.revoke).mockResolvedValue(undefined);
});

const input = {
  companyId: COMPANY,
  locale: 'en' as const,
  installationId: INSTALLATION,
  onRegistered: vi.fn(),
};

it('refuses to enable for a company the settings do not name', async () => {
  vi.mocked(pushCalls.config).mockResolvedValue({
    kind: 'ready',
    config: { ...CONFIG, company_id: OTHER_COMPANY },
  });

  const outcome = await enablePush(input);

  expect(outcome).toEqual({ kind: 'failed' });
  expect(fakes.subscribes).toBe(0);
  expect(unsubscribePush).not.toHaveBeenCalled();
  expect(pushCalls.register).not.toHaveBeenCalled();
  expect(pushCalls.revoke).not.toHaveBeenCalled();
  expect(fakes.record).toBeNull();
});

it('touches nothing when the session cannot be confirmed before the subscription is replaced', async () => {
  fakes.record = { ...RECORD };
  vi.mocked(pushCalls.config)
    .mockResolvedValueOnce({ kind: 'ready', config: CONFIG })
    .mockResolvedValueOnce({ kind: 'not-ready' });

  const outcome = await enablePush(input);

  expect(outcome).toEqual({ kind: 'failed' });
  expect(fakes.subscribes).toBe(0);
  expect(unsubscribePush).not.toHaveBeenCalled();
  expect(pushCalls.register).not.toHaveBeenCalled();
  expect(fakes.record).toEqual(RECORD);
});

it('drops only its own new subscription when the check before the PUT cannot confirm', async () => {
  vi.mocked(pushCalls.config)
    .mockResolvedValueOnce({ kind: 'ready', config: CONFIG })
    .mockResolvedValueOnce({ kind: 'ready', config: CONFIG })
    .mockResolvedValueOnce({ kind: 'not-ready' });

  const outcome = await enablePush(input);

  expect(outcome).toEqual({ kind: 'failed' });
  expect(fakes.subscribes).toBe(1);
  expect(unsubscribePush).toHaveBeenCalledTimes(1);
  expect(pushCalls.register).not.toHaveBeenCalled();
  expect(pushCalls.revoke).not.toHaveBeenCalled();
  expect(fakes.record).toBeNull();
});

it('suspends the old record before touching the subscription when another person signed in', async () => {
  fakes.record = { ...RECORD };
  vi.mocked(pushCalls.config)
    .mockResolvedValueOnce({ kind: 'ready', config: CONFIG })
    .mockResolvedValueOnce({ kind: 'ready', config: { ...CONFIG, subscriber_ref: 'person-s' } });

  const outcome = await enablePush(input);

  expect(outcome).toEqual({ kind: 'failed' });
  expect(fakes.subscribes).toBe(0);
  expect(unsubscribePush).not.toHaveBeenCalled();
  expect(pushCalls.register).not.toHaveBeenCalled();
  expect(fakes.record?.suspended).toBe(true);
  expect(fakes.record?.revision).toBe(RECORD.revision + 1);
});

it('suspends the old record and drops the new subscription when the session changed', async () => {
  fakes.record = { ...RECORD };
  vi.mocked(pushCalls.config)
    .mockResolvedValueOnce({ kind: 'ready', config: CONFIG })
    .mockResolvedValueOnce({ kind: 'ready', config: CONFIG })
    .mockResolvedValueOnce({ kind: 'ready', config: { ...CONFIG, subscriber_ref: 'person-s' } });

  const outcome = await enablePush(input);

  expect(outcome).toEqual({ kind: 'failed' });
  expect(pushCalls.register).not.toHaveBeenCalled();
  expect(pushCalls.revoke).not.toHaveBeenCalled();
  // السجل القديم اتعلّق قبل ما الاشتراك الجديد يتشال: نص صاحبه ما يقدرش يظهر.
  expect(fakes.record?.suspended).toBe(true);
  expect(fakes.record?.revision).toBe(RECORD.revision + 1);
  expect(fakes.record?.token).toBe(RECORD.token);
  expect(notifyPushRecordChanged).toHaveBeenCalled();
  // واحد لتبديل الاشتراك القديم وواحد للاشتراك الجديد اللي اتعمل في المتصفح.
  expect(unsubscribePush).toHaveBeenCalledTimes(2);
});
