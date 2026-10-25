import { beforeEach, expect, it, vi } from 'vitest';
import type { PushConfig } from '@pospay/contracts';

import { pushCalls } from './push-calls';
import type { PushRecord, PushWriteOptions } from './push-record';
import { refreshPush } from './push-refresh';

const INSTALLATION = '12345678-1234-4234-8234-123456789abc';
const DELIVERY = 'test-delivery-a';
const OLD_VAPID = 'oldkey0000000000';

const fakes = vi.hoisted(() => ({
  record: null as PushRecord | null,
  writes: [] as PushRecord[],
  removed: 0,
  subscribed: true,
  unsubscribed: 0,
}));

const RECORD: PushRecord = {
  token: DELIVERY,
  subscriber_ref: 'person-a',
  company_id: 'company',
  vapid_key_id: '0123456789abcdef',
  suspended: false,
  revision: 0,
};

const CONFIG: PushConfig = {
  vapid_public_key: 'public-key',
  vapid_key_id: '0123456789abcdef',
  subscriber_ref: 'person-a',
  company_id: 'company',
};
const OTHER: PushConfig = { ...CONFIG, subscriber_ref: 'person-b' };

vi.mock('./push-record-idb', () => ({
  pushRecordStore: {
    generation: async () => 0,
    read: async () => (fakes.record === null ? null : { ...fakes.record }),
    removeIfMatches: async (expected: { token: string | null; revision: number }) => {
      const stored = fakes.record;
      if (
        stored === null ||
        stored.token !== expected.token ||
        stored.revision !== expected.revision
      ) {
        return false;
      }
      fakes.removed += 1;
      fakes.record = null;
      return true;
    },
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
    currentSubscription: async () => (fakes.subscribed ? subscription() : null),
    subscribeWithDeadline: async () => {
      fakes.subscribed = true;
      return subscription();
    },
    unsubscribePush: async () => {
      fakes.unsubscribed += 1;
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
  fakes.removed = 0;
  fakes.subscribed = true;
  fakes.unsubscribed = 0;
  vi.mocked(pushCalls.config).mockResolvedValue({ kind: 'ready', config: CONFIG });
  vi.mocked(pushCalls.register).mockResolvedValue(undefined);
  vi.mocked(pushCalls.revoke).mockResolvedValue(undefined);
});

const input = (config: PushConfig = CONFIG) => ({
  companyId: 'company',
  locale: 'en' as const,
  config,
  installationId: INSTALLATION,
});

it.each([false, true])(
  'deletes the record when the session belongs to another person (suspended: %s)',
  async (suspended) => {
    fakes.record = { ...RECORD, suspended };
    vi.mocked(pushCalls.config).mockResolvedValue({ kind: 'ready', config: OTHER });

    const outcome = await refreshPush(input());

    expect(outcome).toEqual({ kind: 'cleared' });
    expect(fakes.record).toBeNull();
    expect(fakes.removed).toBe(1);
    expect(fakes.unsubscribed).toBe(1);
    expect(pushCalls.register).not.toHaveBeenCalled();
    expect(pushCalls.revoke).not.toHaveBeenCalled();
  },
);

it('confirms the same person immediately before the plain registration', async () => {
  const outcome = await refreshPush(input());

  expect(outcome).toEqual({ kind: 'refreshed' });
  expect(pushCalls.config).toHaveBeenCalledTimes(2);
  expect(pushCalls.register).toHaveBeenCalledTimes(1);
});

it('sends nothing when the session changes between the fresh read and the PUT', async () => {
  vi.mocked(pushCalls.config)
    .mockResolvedValueOnce({ kind: 'ready', config: CONFIG })
    .mockResolvedValueOnce({ kind: 'ready', config: OTHER });

  const outcome = await refreshPush(input());

  expect(outcome).toEqual({ kind: 'session-changed' });
  expect(fakes.record?.suspended).toBe(true);
  expect(pushCalls.register).not.toHaveBeenCalled();
  expect(fakes.unsubscribed).toBe(0);
});

it.each(['network', 'timeout', 'not-ready'] as const)(
  'does nothing when the fresh config is %s',
  async (failure) => {
    if (failure === 'not-ready') {
      vi.mocked(pushCalls.config).mockResolvedValue({ kind: 'not-ready' });
    } else {
      vi.mocked(pushCalls.config).mockRejectedValue(new Error(failure));
    }

    const outcome = await refreshPush(input());

    expect(outcome).toEqual({ kind: 'none' });
    expect(fakes.record).toEqual(RECORD);
    expect(fakes.writes).toEqual([]);
    expect(fakes.unsubscribed).toBe(0);
    expect(pushCalls.register).not.toHaveBeenCalled();
    expect(pushCalls.revoke).not.toHaveBeenCalled();
  },
);

it('drops only the new rotation subscription when the session changes before its PUT', async () => {
  fakes.record = { ...RECORD, vapid_key_id: OLD_VAPID };
  vi.mocked(pushCalls.config)
    .mockResolvedValueOnce({ kind: 'ready', config: CONFIG })
    .mockResolvedValueOnce({ kind: 'ready', config: CONFIG })
    .mockResolvedValueOnce({ kind: 'ready', config: OTHER });

  const outcome = await refreshPush(input());

  expect(outcome).toEqual({ kind: 'session-changed' });
  expect(fakes.record?.suspended).toBe(true);
  expect(fakes.record?.vapid_key_id).toBe(OLD_VAPID);
  expect(fakes.unsubscribed).toBe(2);
  expect(fakes.subscribed).toBe(false);
  expect(pushCalls.register).not.toHaveBeenCalled();
  expect(pushCalls.revoke).not.toHaveBeenCalled();
});

it('rotates with the fresh key id rather than the caller config', async () => {
  fakes.record = { ...RECORD, vapid_key_id: OLD_VAPID };

  const outcome = await refreshPush(input({ ...CONFIG, vapid_key_id: OLD_VAPID }));

  expect(outcome).toEqual({
    kind: 'rotated',
    token: expect.any(String),
    vapid_key_id: CONFIG.vapid_key_id,
  });
  expect(pushCalls.config).toHaveBeenCalledTimes(3);
  expect(vi.mocked(pushCalls.register).mock.calls[0]?.[0].vapid_key_id).toBe(CONFIG.vapid_key_id);
});
