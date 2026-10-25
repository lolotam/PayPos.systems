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
  company_id: 'company',
};
const PREVIOUS = 'test-previous-a';

const RECORD: PushRecord = {
  token: PREVIOUS,
  subscriber_ref: 'subscriber-ref',
  company_id: 'company',
  vapid_key_id: '0123456789abcdef',
  suspended: false,
  revision: 0,
};

const fakes = vi.hoisted(() => ({
  record: null as PushRecord | null,
  generation: 0,
  readFails: false,
}));

vi.mock('./push-lock', () => ({
  hasCrossTabLock: () => true,
  runPushExclusive: <T>(work: () => Promise<T>) => work(),
}));

vi.mock('./push-record-events', () => ({ notifyPushRecordChanged: vi.fn() }));

vi.mock('./push-record-idb', () => ({
  pushRecordStore: {
    generation: async () => fakes.generation,
    read: async () => {
      if (fakes.readFails) throw new Error('PUSH_STORE_UNAVAILABLE');
      return fakes.record === null ? null : { ...fakes.record };
    },
    suspend: async () => {
      const stored = fakes.record;
      if (stored === null) return null;
      const suspended = { ...stored, suspended: true, revision: stored.revision + 1 };
      fakes.record = suspended;
      return { record: suspended, generation: fakes.generation };
    },
    writeIfGeneration: async (record: PushRecord, expected: number, options?: PushWriteOptions) => {
      if (expected !== fakes.generation) return false;
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

const input = {
  companyId: 'company',
  locale: 'en' as const,
  installationId: INSTALLATION,
  onRegistered: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(pushCalls.register).mockReset();
  vi.mocked(pushCalls.register).mockResolvedValue(undefined);
  fakes.record = null;
  fakes.generation = 0;
  fakes.readFails = false;
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

it('tears the registration down when the record was removed while it was registering', async () => {
  vi.mocked(pushCalls.register).mockImplementation(async () => {
    // خروج في تبويب تاني كسر الجيل ومسح السجل أثناء تسجيلنا.
    fakes.generation = 1;
    fakes.record = null;
  });

  const outcome = await enablePush(input);

  expect(outcome).toEqual({ kind: 'failed' });
  expect(unsubscribePush).toHaveBeenCalledTimes(1);
  expect(pushCalls.revoke).toHaveBeenCalledWith(INSTALLATION, expect.any(AbortSignal));
});

it('tears the registration down when a sign-in suspension bumped the record revision', async () => {
  fakes.record = { ...RECORD };
  vi.mocked(pushCalls.register).mockImplementation(async () => {
    // تعليق دخول وصل وقت التسجيل: نفس التوكن بمراجعة أعلى.
    fakes.record = { ...RECORD, suspended: true, revision: 1 };
  });

  const outcome = await enablePush(input);

  expect(outcome).toEqual({ kind: 'failed' });
  // واحد لتبديل الاشتراك القديم وواحد للتفكيك.
  expect(unsubscribePush).toHaveBeenCalledTimes(2);
  expect(pushCalls.revoke).toHaveBeenCalledWith(INSTALLATION, expect.any(AbortSignal));
  expect(fakes.record?.suspended).toBe(true);
  expect(fakes.record?.revision).toBe(1);
});

it('fails without touching the network when the local record cannot be read', async () => {
  fakes.readFails = true;

  const outcome = await enablePush(input);

  expect(outcome).toEqual({ kind: 'failed' });
  expect(pushCalls.config).not.toHaveBeenCalled();
  expect(pushCalls.register).not.toHaveBeenCalled();
  expect(unsubscribePush).not.toHaveBeenCalled();
  expect(pushCalls.revoke).not.toHaveBeenCalled();
});

it('suspends the old record and drops the new subscription when the session changes', async () => {
  fakes.record = { ...RECORD };
  vi.mocked(pushCalls.config)
    .mockResolvedValueOnce({ kind: 'ready', config: CONFIG })
    .mockResolvedValueOnce({ kind: 'ready', config: CONFIG })
    .mockResolvedValueOnce({
      kind: 'ready',
      config: { ...CONFIG, subscriber_ref: 'another-ref' },
    });

  const outcome = await enablePush(input);

  expect(outcome).toEqual({ kind: 'failed' });
  expect(pushCalls.register).not.toHaveBeenCalled();
  expect(unsubscribePush).toHaveBeenCalledTimes(2);
  expect(pushCalls.revoke).not.toHaveBeenCalled();
  // التعليق بيحصل قبل الإلغاء: السجل القديم ما يفضلش مفتوح ونص صاحبه يظهر.
  expect(fakes.record?.suspended).toBe(true);
  expect(fakes.record?.revision).toBe(RECORD.revision + 1);
});

it('registers after the current session confirms the same person', async () => {
  const outcome = await enablePush(input);

  expect(outcome.kind).toBe('enabled');
  expect(pushCalls.config).toHaveBeenCalledTimes(3);
  expect(pushCalls.register).toHaveBeenCalledTimes(1);
  expect(pushCalls.revoke).not.toHaveBeenCalled();
});
