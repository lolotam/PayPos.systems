import { beforeEach, expect, it, vi } from 'vitest';
import type { PushConfig } from '@pospay/contracts';

import { pushCalls } from './push-calls';
import type { PushRecord } from './push-record';
import { refreshPush } from './push-refresh';

const INSTALLATION = '12345678-1234-4234-8234-123456789abc';

const fakes = vi.hoisted(() => {
  const state = {
    record: null as PushRecord | null,
    writes: [] as PushRecord[],
    writeFails: false,
    generation: 0,
    removed: 0,
    subscribed: false,
    unsubscribed: 0,
    subscribedWithKey: null as number[] | null,
  };
  return { state };
});

const RECORD: PushRecord = {
  token: 'delivery-token',
  subscriber_ref: 'subscriber-ref',
  company_id: 'company',
  vapid_key_id: '0123456789abcdef',
  suspended: false,
};

const CONFIG: PushConfig = {
  vapid_public_key: 'public-key',
  vapid_key_id: '0123456789abcdef',
  subscriber_ref: 'subscriber-ref',
};

vi.mock('./push-record-idb', () => ({
  pushRecordStore: {
    read: async () => fakes.state.record,
    write: async (record: PushRecord) => {
      if (fakes.state.writeFails) throw new Error('PUSH_STORE_UNAVAILABLE');
      fakes.state.record = record;
      fakes.state.writes.push(record);
    },
    remove: async () => {
      fakes.state.removed += 1;
      fakes.state.record = null;
    },
    generation: async () => fakes.state.generation,
    bumpGeneration: async () => {
      fakes.state.generation += 1;
      return fakes.state.generation;
    },
    writeIfGeneration: async (
      record: PushRecord,
      expected: number,
      options?: { clearSuspension?: boolean },
    ) => {
      if (fakes.state.generation !== expected) return false;
      const suspended = fakes.state.record?.suspended === true && options?.clearSuspension !== true;
      fakes.state.record = suspended ? { ...record, suspended: true } : record;
      fakes.state.writes.push(fakes.state.record);
      return true;
    },
  },
}));

vi.mock('./push-browser', () => ({
  notificationPermission: () => 'granted' as const,
  currentSubscription: async () =>
    fakes.state.subscribed
      ? {
          endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
          unsubscribe: async () => true,
          toJSON: () => ({
            endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
            expirationTime: null,
            keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
          }),
        }
      : null,
  subscribePush: async (key: Uint8Array<ArrayBuffer>) => {
    fakes.state.subscribedWithKey = Array.from(key);
    fakes.state.subscribed = true;
    return {
      endpoint: 'https://fcm.googleapis.com/fcm/send/rotated',
      unsubscribe: async () => true,
      toJSON: () => ({
        endpoint: 'https://fcm.googleapis.com/fcm/send/rotated',
        expirationTime: null,
        keys: { p256dh: 'q'.repeat(87), auth: 'b'.repeat(22) },
      }),
    };
  },
  subscribeWithDeadline: async (key: Uint8Array<ArrayBuffer>) => {
    fakes.state.subscribedWithKey = Array.from(key);
    fakes.state.subscribed = true;
    return {
      endpoint: 'https://fcm.googleapis.com/fcm/send/rotated',
      unsubscribe: async () => true,
      toJSON: () => ({
        endpoint: 'https://fcm.googleapis.com/fcm/send/rotated',
        expirationTime: null,
        keys: { p256dh: 'q'.repeat(87), auth: 'b'.repeat(22) },
      }),
    };
  },
  unsubscribePush: async () => {
    fakes.state.unsubscribed += 1;
    fakes.state.subscribed = false;
    return true;
  },
  base64UrlToBytes: () => new Uint8Array([7, 7]),
  pushSubscriptionBody: () => ({
    endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
    expirationTime: null,
    keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
  }),
}));

vi.mock('./push-calls', () => ({
  pushCalls: { config: vi.fn(), register: vi.fn(), revoke: vi.fn() },
  withTimeout: <T>(promise: Promise<T>) => promise,
  withAbortTimeout: <T>(run: (signal: AbortSignal) => Promise<T>) =>
    run(new AbortController().signal),
}));

beforeEach(() => {
  vi.clearAllMocks();
  fakes.state.record = { ...RECORD };
  fakes.state.writes = [];
  fakes.state.writeFails = false;
  fakes.state.generation = 0;
  fakes.state.removed = 0;
  fakes.state.subscribed = true;
  fakes.state.unsubscribed = 0;
  fakes.state.subscribedWithKey = null;
  vi.mocked(pushCalls.register).mockResolvedValue(undefined);
  vi.mocked(pushCalls.revoke).mockResolvedValue(undefined);
});

const input = (config: PushConfig = CONFIG) => ({
  companyId: 'company',
  locale: 'en' as const,
  config,
  installationId: INSTALLATION,
});

it('replaces the browser subscription and registers the new key after a rotation', async () => {
  fakes.state.record = { ...RECORD, vapid_key_id: 'oldkey0000000000' };

  const outcome = await refreshPush(input());

  expect(outcome.kind).toBe('rotated');
  expect(fakes.state.unsubscribed).toBe(1);
  expect(fakes.state.subscribed).toBe(true);
  const body = vi.mocked(pushCalls.register).mock.calls[0]?.[0];
  expect(body?.vapid_key_id).toBe('0123456789abcdef');
  expect(body?.delivery_token).not.toBe(RECORD.token);
  expect(fakes.state.record?.vapid_key_id).toBe('0123456789abcdef');
  expect(fakes.state.record?.token).not.toBe(RECORD.token);
});

it('registers the same subscription again with the current locale', async () => {
  const outcome = await refreshPush(input());

  expect(outcome).toEqual({ kind: 'refreshed' });
  expect(pushCalls.register).toHaveBeenCalledTimes(1);
  const body = vi.mocked(pushCalls.register).mock.calls[0]?.[0];
  expect(body?.delivery_token).toBe(RECORD.token);
  expect(body?.vapid_key_id).toBe('0123456789abcdef');
  expect(body?.locale).toBe('en');
});

it('sends nothing when the record belongs to another company', async () => {
  fakes.state.record = { ...RECORD, company_id: 'another-company' };

  const outcome = await refreshPush(input());

  expect(outcome).toEqual({ kind: 'none' });
  expect(pushCalls.register).not.toHaveBeenCalled();
});

it('removes the record when the browser holds no subscription', async () => {
  fakes.state.subscribed = false;

  const outcome = await refreshPush(input());

  expect(outcome).toEqual({ kind: 'cleared' });
  expect(fakes.state.removed).toBe(1);
  expect(pushCalls.revoke).toHaveBeenCalledWith(INSTALLATION);
});

it('restores a suspended record of this company when the subscriber reference matches', async () => {
  fakes.state.record = { ...RECORD, suspended: true };

  const outcome = await refreshPush(input());

  expect(outcome).toEqual({ kind: 'refreshed' });
  expect(fakes.state.record?.suspended).toBe(false);
  expect(fakes.state.removed).toBe(0);
  expect(fakes.state.unsubscribed).toBe(0);
});

it('removes a suspended record of this company when the subscriber reference differs', async () => {
  fakes.state.record = { ...RECORD, suspended: true };

  const outcome = await refreshPush(input({ ...CONFIG, subscriber_ref: 'another-ref' }));

  expect(outcome).toEqual({ kind: 'cleared' });
  expect(fakes.state.removed).toBe(1);
  expect(fakes.state.unsubscribed).toBe(1);
  expect(fakes.state.record).toBeNull();
});

it('leaves a suspended record of another company untouched', async () => {
  fakes.state.record = { ...RECORD, suspended: true, company_id: 'another-company' };

  const outcome = await refreshPush(input());

  expect(outcome).toEqual({ kind: 'none' });
  expect(fakes.state.record?.suspended).toBe(true);
  expect(fakes.state.removed).toBe(0);
  expect(pushCalls.register).not.toHaveBeenCalled();
});

it('removes a record of another person and sends no registration', async () => {
  fakes.state.record = { ...RECORD };

  const outcome = await refreshPush(input({ ...CONFIG, subscriber_ref: 'another-ref' }));

  expect(outcome).toEqual({ kind: 'cleared' });
  expect(fakes.state.removed).toBe(1);
  expect(fakes.state.unsubscribed).toBe(1);
  expect(fakes.state.record).toBeNull();
  expect(pushCalls.register).not.toHaveBeenCalled();
});

it('removes the record when the rotation cannot write it', async () => {
  fakes.state.record = { ...RECORD, vapid_key_id: 'oldkey0000000000' };
  fakes.state.writeFails = true;

  const outcome = await refreshPush(input());

  expect(outcome).toEqual({ kind: 'cleared' });
  expect(fakes.state.removed).toBe(1);
  expect(fakes.state.record).toBeNull();
});
