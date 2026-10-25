import { beforeEach, expect, it, vi } from 'vitest';
import type { PushConfig } from '@pospay/contracts';

import { pushCalls } from './push-calls';
import { notifyPushRecordChanged } from './push-record-events';
import type { PushRecord, PushWriteOptions } from './push-record';
import { refreshPush } from './push-refresh';

const INSTALLATION = '12345678-1234-4234-8234-123456789abc';
const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';
const PERSON = 'person-r';
const DELIVERY = 'test-delivery-a';

const fakes = vi.hoisted(() => ({
  record: null as PushRecord | null,
  writes: [] as PushRecord[],
  unsubscribed: 0,
  removed: 0,
}));

const RECORD: PushRecord = {
  token: DELIVERY,
  subscriber_ref: PERSON,
  company_id: COMPANY_A,
  vapid_key_id: '0123456789abcdef',
  suspended: false,
  revision: 0,
};

const CONFIG_A: PushConfig = {
  vapid_public_key: 'public-key',
  vapid_key_id: '0123456789abcdef',
  subscriber_ref: PERSON,
  company_id: COMPANY_A,
};
// نفس الموظفة وشركة تانية: مرجع المشترك واحد، بس هوية الجلسة اتغيرت.
const CONFIG_B: PushConfig = { ...CONFIG_A, company_id: COMPANY_B };
const OTHER_PERSON: PushConfig = { ...CONFIG_A, subscriber_ref: 'person-s' };

vi.mock('./push-record-events', () => ({ notifyPushRecordChanged: vi.fn() }));

vi.mock('./push-record-idb', () => ({
  pushRecordStore: {
    generation: async () => 0,
    read: async () => (fakes.record === null ? null : { ...fakes.record }),
    remove: async () => {
      fakes.removed += 1;
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
    currentSubscription: async () => subscription(),
    subscribeWithDeadline: async () => subscription(),
    unsubscribePush: async () => {
      fakes.unsubscribed += 1;
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
  fakes.removed = 0;
  vi.mocked(pushCalls.config).mockResolvedValue({ kind: 'ready', config: CONFIG_A });
  vi.mocked(pushCalls.register).mockResolvedValue(undefined);
  vi.mocked(pushCalls.revoke).mockResolvedValue(undefined);
});

const input = (config: PushConfig = CONFIG_A) => ({
  companyId: COMPANY_A,
  locale: 'en' as const,
  config,
  installationId: INSTALLATION,
});

it('changes nothing when the same person signed in to another company', async () => {
  vi.mocked(pushCalls.config).mockResolvedValue({ kind: 'ready', config: CONFIG_B });

  const outcome = await refreshPush(input());

  expect(outcome).toEqual({ kind: 'none' });
  expect(pushCalls.register).not.toHaveBeenCalled();
  expect(fakes.record).toEqual(RECORD);
  expect(notifyPushRecordChanged).not.toHaveBeenCalled();
  expect(fakes.unsubscribed).toBe(0);
  expect(fakes.removed).toBe(0);
  expect(pushCalls.revoke).not.toHaveBeenCalled();
});

it('suspends first when another person signed in to another company', async () => {
  vi.mocked(pushCalls.config).mockResolvedValue({
    kind: 'ready',
    config: { ...CONFIG_B, subscriber_ref: OTHER_PERSON.subscriber_ref },
  });

  const outcome = await refreshPush(input());

  expect(outcome).toEqual({ kind: 'session-changed' });
  expect(fakes.record?.suspended).toBe(true);
  expect(pushCalls.register).not.toHaveBeenCalled();
});

it('suspends the record at once when the session belongs to another person', async () => {
  vi.mocked(pushCalls.config).mockResolvedValue({ kind: 'ready', config: OTHER_PERSON });

  const outcome = await refreshPush(input());

  expect(outcome).toEqual({ kind: 'session-changed' });
  expect(fakes.record?.suspended).toBe(true);
  expect(fakes.record?.revision).toBe(RECORD.revision + 1);
  expect(pushCalls.register).not.toHaveBeenCalled();
  expect(notifyPushRecordChanged).toHaveBeenCalled();
});

it('suspends the record again when the session changes before the PUT', async () => {
  fakes.record = { ...RECORD, suspended: true, revision: 3 };
  vi.mocked(pushCalls.config)
    .mockResolvedValueOnce({ kind: 'ready', config: CONFIG_A })
    .mockResolvedValueOnce({ kind: 'ready', config: CONFIG_A })
    .mockResolvedValueOnce({ kind: 'ready', config: OTHER_PERSON });

  const outcome = await refreshPush(input());

  expect(outcome).toEqual({ kind: 'session-changed' });
  expect(pushCalls.register).not.toHaveBeenCalled();
  expect(fakes.record?.suspended).toBe(true);
  expect(fakes.record?.revision).toBe(4);
});
