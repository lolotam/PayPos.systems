import { beforeEach, expect, it, vi } from 'vitest';
import type { PushConfig } from '@pospay/contracts';

import { pushCalls } from './push-calls';
import { notifyPushRecordChanged } from './push-record-events';
import type { PushRecord, PushWriteOptions } from './push-record';
import { refreshPush } from './push-refresh';

const INSTALLATION = '12345678-1234-4234-8234-123456789abc';
const COMPANY = 'company-a';
const PERSON = 'person-r';
const DELIVERY = 'test-delivery-a';
const OLD_VAPID = 'oldkey0000000000';
const NEW_VAPID = '0123456789abcdef';

const fakes = vi.hoisted(() => {
  let markStarted = (): void => undefined;
  let release = (): void => undefined;
  const started = new Promise<void>((done) => {
    markStarted = done;
  });
  const gate = new Promise<void>((done) => {
    release = done;
  });
  return {
    record: null as PushRecord | null,
    writes: [] as PushRecord[],
    unsubscribed: 0,
    subscribed: true,
    /** الاختبار بيقرفلإلغاء الاشتراك التاني عشان يثبت إن التعليق بسبق الإلغاء. */
    holdDrop: false,
    dropStarted: started,
    dropGate: gate,
    markDropStarted: () => markStarted(),
    releaseDrop: () => release(),
  };
});

const RECORD: PushRecord = {
  token: DELIVERY,
  subscriber_ref: PERSON,
  company_id: COMPANY,
  vapid_key_id: OLD_VAPID,
  suspended: false,
  revision: 0,
};

const CONFIG: PushConfig = {
  vapid_public_key: 'public-key',
  vapid_key_id: NEW_VAPID,
  subscriber_ref: PERSON,
  company_id: COMPANY,
};
const OTHER_PERSON: PushConfig = { ...CONFIG, subscriber_ref: 'person-s' };

vi.mock('./push-record-events', () => ({ notifyPushRecordChanged: vi.fn() }));

vi.mock('./push-record-idb', () => ({
  pushRecordStore: {
    generation: async () => 0,
    read: async () => (fakes.record === null ? null : { ...fakes.record }),
    remove: async () => {
      fakes.record = null;
    },
    suspend: async () => {
      const stored = fakes.record;
      if (stored === null) return null;
      const suspended = { ...stored, suspended: true, revision: stored.revision + 1 };
      fakes.record = suspended;
      fakes.writes.push(suspended);
      return { record: suspended, generation: 0 };
    },
    writeIfGeneration: async (
      record: PushRecord,
      _expected: number,
      options?: PushWriteOptions,
    ) => {
      const stored = fakes.record;
      if (options?.expectRevision !== undefined && stored?.revision !== options.expectRevision) {
        return false;
      }
      if (options?.expectToken !== undefined && stored?.token !== options.expectToken) return false;
      fakes.record = record;
      fakes.writes.push(record);
      return true;
    },
  },
}));

vi.mock('./push-browser', () => {
  const subscription = () => ({
    endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
    unsubscribe: async () => true,
    toJSON: () => ({
      endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
      expirationTime: null,
      keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
    }),
  });
  return {
    notificationPermission: () => 'granted' as const,
    currentSubscription: async () => (fakes.subscribed ? subscription() : null),
    subscribeWithDeadline: async () => {
      fakes.subscribed = true;
      return subscription();
    },
    unsubscribePush: async () => {
      fakes.unsubscribed += 1;
      if (fakes.holdDrop && fakes.unsubscribed === 2) {
        fakes.markDropStarted();
        await fakes.dropGate;
      }
      fakes.subscribed = false;
      return true;
    },
    base64UrlToBytes: () => new Uint8Array([7, 7]),
    pushSubscriptionBody: () => ({
      endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
      expirationTime: null,
      keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
    }),
  };
});

vi.mock('./push-calls', () => ({
  pushCalls: { config: vi.fn(), register: vi.fn(), revoke: vi.fn() },
  withAbortTimeout: <T>(run: (signal: AbortSignal) => Promise<T>) =>
    run(new AbortController().signal),
}));

beforeEach(() => {
  vi.clearAllMocks();
  fakes.record = { ...RECORD };
  fakes.writes = [];
  fakes.unsubscribed = 0;
  fakes.subscribed = true;
  fakes.holdDrop = false;
  vi.mocked(pushCalls.config).mockResolvedValue({ kind: 'ready', config: CONFIG });
  vi.mocked(pushCalls.register).mockResolvedValue(undefined);
  vi.mocked(pushCalls.revoke).mockResolvedValue(undefined);
});

const input = (config: PushConfig = CONFIG) => ({
  companyId: COMPANY,
  locale: 'en' as const,
  config,
  installationId: INSTALLATION,
});

it('changes nothing when the check before the rotation cannot confirm the session', async () => {
  vi.mocked(pushCalls.config)
    .mockResolvedValueOnce({ kind: 'ready', config: CONFIG })
    .mockRejectedValueOnce(new Error('PUSH_CONFIG_REFUSED'));

  const outcome = await refreshPush(input());

  expect(outcome).toEqual({ kind: 'none' });
  expect(fakes.unsubscribed).toBe(0);
  expect(fakes.subscribed).toBe(true);
  expect(fakes.writes).toEqual([]);
  expect(fakes.record).toEqual(RECORD);
  expect(pushCalls.register).not.toHaveBeenCalled();
  expect(pushCalls.revoke).not.toHaveBeenCalled();
});

it('drops only its own new rotation subscription when the check before the PUT cannot confirm', async () => {
  vi.mocked(pushCalls.config)
    .mockResolvedValueOnce({ kind: 'ready', config: CONFIG })
    .mockResolvedValueOnce({ kind: 'ready', config: CONFIG })
    .mockResolvedValueOnce({ kind: 'not-ready' });

  const outcome = await refreshPush(input());

  expect(outcome).toEqual({ kind: 'none' });
  // واحد لتبديل القديم وواحد للاشتراك الجديد بس: السجل ما اتلمسش والتحديث الجاي يدور تاني.
  expect(fakes.unsubscribed).toBe(2);
  expect(fakes.subscribed).toBe(false);
  expect(fakes.writes).toEqual([]);
  expect(pushCalls.register).not.toHaveBeenCalled();
  expect(pushCalls.revoke).not.toHaveBeenCalled();
});

it('registers nothing when the check before the plain PUT cannot confirm', async () => {
  fakes.record = { ...RECORD, vapid_key_id: NEW_VAPID };
  vi.mocked(pushCalls.config)
    .mockResolvedValueOnce({ kind: 'ready', config: CONFIG })
    .mockResolvedValueOnce({ kind: 'not-ready' });

  const outcome = await refreshPush(input());

  expect(outcome).toEqual({ kind: 'none' });
  expect(fakes.unsubscribed).toBe(0);
  expect(fakes.writes).toEqual([]);
  expect(fakes.record).toEqual({ ...RECORD, vapid_key_id: NEW_VAPID });
  expect(pushCalls.register).not.toHaveBeenCalled();
});

it('drops the own new subscription and suspends when the session changes', async () => {
  vi.mocked(pushCalls.config)
    .mockResolvedValueOnce({ kind: 'ready', config: CONFIG })
    .mockResolvedValueOnce({ kind: 'ready', config: CONFIG })
    .mockResolvedValueOnce({ kind: 'ready', config: OTHER_PERSON });

  const outcome = await refreshPush(input());

  expect(outcome).toEqual({ kind: 'session-changed' });
  // التبديل والاشتراك الجديد اللي اتعمل في المتصفح: اتشالوا كلهم.
  expect(fakes.unsubscribed).toBe(2);
  expect(fakes.subscribed).toBe(false);
  expect(fakes.record?.suspended).toBe(true);
  expect(fakes.record?.revision).toBe(RECORD.revision + 1);
  expect(notifyPushRecordChanged).toHaveBeenCalled();
  expect(pushCalls.register).not.toHaveBeenCalled();
  expect(pushCalls.revoke).not.toHaveBeenCalled();
});

it('suspends the record before it drops the new subscription', async () => {
  fakes.holdDrop = true;
  vi.mocked(pushCalls.config)
    .mockResolvedValueOnce({ kind: 'ready', config: CONFIG })
    .mockResolvedValueOnce({ kind: 'ready', config: CONFIG })
    .mockResolvedValueOnce({ kind: 'ready', config: OTHER_PERSON });

  const refreshing = refreshPush(input());

  await fakes.dropStarted;

  // الإلغاء لسه معلّق: السجل لازم يكون اتعلّق خلاص، وإلا نص الموظفة القديمة يقدر يظهر.
  expect(fakes.unsubscribed).toBe(2);
  expect(fakes.record?.suspended).toBe(true);
  expect(fakes.record?.revision).toBe(RECORD.revision + 1);

  fakes.releaseDrop();

  expect(await refreshing).toEqual({ kind: 'session-changed' });
});

it('rotates with the key id the fresh config served', async () => {
  const outcome = await refreshPush(input({ ...CONFIG, vapid_key_id: OLD_VAPID }));

  expect(outcome).toEqual({
    kind: 'rotated',
    token: expect.any(String),
    vapid_key_id: NEW_VAPID,
  });
  expect(vi.mocked(pushCalls.register).mock.calls[0]?.[0].vapid_key_id).toBe(NEW_VAPID);
  expect(fakes.record?.vapid_key_id).toBe(NEW_VAPID);
});
