import { beforeEach, expect, it, vi } from 'vitest';

import { unsubscribePush } from './push-browser';
import { pushCalls } from './push-calls';
import { enablePush } from './push-enable';
import type { PushRecord, PushWriteOptions } from './push-record';

const INSTALLATION = '12345678-1234-4234-8234-123456789abc';
const CONFIG = {
  vapid_public_key: 'public-key',
  vapid_key_id: '0123456789abcdef',
  subscriber_ref: 'subscriber-ref',
};

const fakes = vi.hoisted(() => ({
  record: null as PushRecord | null,
}));

vi.mock('./push-lock', () => ({
  runPushExclusive: <T>(work: () => Promise<T>) => work(),
}));

vi.mock('./push-record-events', () => ({ notifyPushRecordChanged: vi.fn() }));

vi.mock('./push-record-idb', () => ({
  pushRecordStore: {
    generation: async () => 0,
    read: async () => (fakes.record === null ? null : { ...fakes.record }),
    writeIfGeneration: async (record: PushRecord, expected: number, options?: PushWriteOptions) => {
      if (expected !== 0) return false;
      const stored = fakes.record;
      if (
        options?.expectRevision !== undefined &&
        (stored?.revision ?? 0) !== options.expectRevision
      ) {
        return false;
      }
      if (options?.expectToken !== undefined && (stored?.token ?? null) !== options.expectToken) {
        return false;
      }
      fakes.record = record;
      return true;
    },
  },
}));

vi.mock('./push-browser', () => ({
  notificationPermission: () => 'granted' as const,
  requestNotificationPermission: async () => 'granted' as const,
  currentSubscription: async () => null,
  subscribeWithDeadline: async () => ({
    endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
    unsubscribe: async () => true,
    toJSON: () => ({
      endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
      expirationTime: null,
      keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
    }),
  }),
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
  withAbortTimeout: <T>(run: (signal: AbortSignal) => Promise<T>) =>
    run(new AbortController().signal),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.record = null;
  vi.mocked(pushCalls.config).mockResolvedValue({ kind: 'ready', config: CONFIG });
  vi.mocked(pushCalls.revoke).mockResolvedValue(undefined);
});

it('refuses the second enable when both started from an empty record', async () => {
  const firstRegistration = deferred<undefined>();
  const secondRegistration = deferred<undefined>();
  const bothRegistered = deferred<undefined>();
  let registrations = 0;
  vi.mocked(pushCalls.register).mockImplementation(() => {
    registrations += 1;
    if (registrations === 2) bothRegistered.resolve(undefined);
    return registrations === 1 ? firstRegistration.promise : secondRegistration.promise;
  });
  const input = {
    companyId: 'company',
    locale: 'en' as const,
    installationId: INSTALLATION,
    onRegistered: vi.fn(),
  };

  const first = enablePush(input);
  const second = enablePush(input);
  await bothRegistered.promise;
  firstRegistration.resolve(undefined);
  expect((await first).kind).toBe('enabled');
  const firstToken = vi.mocked(pushCalls.register).mock.calls[0]?.[0].delivery_token;
  const secondToken = vi.mocked(pushCalls.register).mock.calls[1]?.[0].delivery_token;
  expect(fakes.record?.token).toBe(firstToken);

  secondRegistration.resolve(undefined);
  expect(await second).toEqual({ kind: 'failed' });

  expect(secondToken).not.toBe(firstToken);
  expect(fakes.record?.token).toBe(firstToken);
  expect(unsubscribePush).toHaveBeenCalledTimes(1);
  expect(pushCalls.revoke).toHaveBeenCalledWith(INSTALLATION, expect.any(AbortSignal));
});
