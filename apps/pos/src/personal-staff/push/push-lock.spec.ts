import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { disablePush } from './push-disable';
import { enablePush } from './push-enable';
import { runPushExclusive } from './push-lock';
import type { PushRecord } from './push-record';
import { refreshPush } from './push-refresh';

const INSTALLATION = '12345678-1234-4234-8234-123456789abc';
const FIRST = 'https://fcm.googleapis.com/fcm/send/one';
const SECOND = 'https://fcm.googleapis.com/fcm/send/two';

const fakes = vi.hoisted(() => {
  const state = {
    config: {
      vapid_public_key: 'public-key',
      vapid_key_id: '0123456789abcdef',
      subscriber_ref: 'subscriber-ref',
    },
    record: null as PushRecord | null,
    removed: 0,
    endpoint: 'https://fcm.googleapis.com/fcm/send/one',
    unsubscribed: 0,
    registers: [] as { token: string; endpoint: string }[],
    permission: 'default' as 'default' | 'granted' | 'denied',
    order: [] as string[],
    gate: null as Promise<void> | null,
    gateReached: null as (() => void) | null,
    gateUsed: false,
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

vi.mock('./push-record-idb', () => ({
  pushRecordStore: {
    read: async () => fakes.state.record,
    write: async (record: PushRecord) => {
      fakes.state.record = record;
    },
    remove: async () => {
      fakes.state.removed += 1;
      fakes.state.record = null;
    },
  },
}));

vi.mock('./push-browser', () => ({
  notificationPermission: () => fakes.state.permission,
  requestNotificationPermission: async () => {
    fakes.state.order.push('permission');
    fakes.state.permission = 'granted';
    return 'granted' as const;
  },
  currentSubscription: async () => {
    if (fakes.state.gate !== null && !fakes.state.gateUsed) {
      fakes.state.gateUsed = true;
      fakes.state.gateReached?.();
      await fakes.state.gate;
    }
    return {
      endpoint: fakes.state.endpoint,
      unsubscribe: async () => true,
      toJSON: () => ({
        endpoint: fakes.state.endpoint,
        expirationTime: null,
        keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
      }),
    };
  },
  subscribePush: async () => {
    fakes.state.endpoint = 'https://fcm.googleapis.com/fcm/send/two';
    return {
      endpoint: fakes.state.endpoint,
      unsubscribe: async () => true,
      toJSON: () => ({
        endpoint: fakes.state.endpoint,
        expirationTime: null,
        keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
      }),
    };
  },
  unsubscribePush: async () => {
    fakes.state.unsubscribed += 1;
    return true;
  },
  base64UrlToBytes: () => new Uint8Array([1, 2, 3]),
  pushSubscriptionBody: (subscription: { endpoint: string }) => ({
    endpoint: subscription.endpoint,
    expirationTime: null,
    keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
  }),
}));

vi.mock('./push-calls', () => ({
  pushCalls: {
    config: vi.fn(async () => ({ kind: 'ready' as const, config: fakes.state.config })),
    register: vi.fn(
      async (input: { delivery_token: string; subscription: { endpoint: string } }) => {
        fakes.state.registers.push({
          token: input.delivery_token,
          endpoint: input.subscription.endpoint,
        });
      },
    ),
    revoke: vi.fn(async () => undefined),
  },
  PushApiError: class extends Error {},
  PushKeyStaleError: class extends Error {},
  withTimeout: <T>(promise: Promise<T>) => promise,
}));

function gate(): { reached: Promise<void>; release: () => void } {
  let release = (): void => undefined;
  let reached = (): void => undefined;
  const reachedPromise = new Promise<void>((resolve) => {
    reached = resolve;
  });
  fakes.state.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  fakes.state.gateReached = () => reached();
  return { reached: reachedPromise, release: () => release() };
}

// القفل الأصلي بتاع البيئة (تسلسل حقيقي)؛ الاختبارات اللي بتغيّره بترجّعه تاني عشان
// اختبارات السباق اللي بعده تشتغل على القفل الحقيقي.
const locksDescriptor = Object.getOwnPropertyDescriptor(globalThis.navigator, 'locks');

function withoutLocks(): void {
  Object.defineProperty(globalThis.navigator, 'locks', { value: undefined, configurable: true });
}

function recordingLocks(order: string[]): void {
  Object.defineProperty(globalThis.navigator, 'locks', {
    value: {
      request: async (_name: string, run: () => Promise<unknown>) => {
        order.push('lock');
        return run();
      },
    },
    configurable: true,
  });
}

beforeEach(() => {
  fakes.state.record = { ...RECORD };
  fakes.state.removed = 0;
  fakes.state.endpoint = FIRST;
  fakes.state.unsubscribed = 0;
  fakes.state.registers = [];
  fakes.state.permission = 'granted';
  fakes.state.order = [];
  fakes.state.gate = null;
  fakes.state.gateReached = null;
  fakes.state.gateUsed = false;
});

afterEach(() => {
  fakes.state.gate = null;
  if (locksDescriptor !== undefined) {
    Object.defineProperty(globalThis.navigator, 'locks', locksDescriptor);
  }
});

it('asks for the browser permission before the locked work starts', async () => {
  fakes.state.permission = 'default';
  recordingLocks(fakes.state.order);

  const outcome = await enablePush({
    companyId: 'company',
    locale: 'en',
    installationId: INSTALLATION,
    onRegistered: () => undefined,
  });

  expect(outcome.kind).toBe('enabled');
  expect(fakes.state.order).toEqual(['permission', 'lock']);
});

it('turning off while a rotation is in flight leaves the record deleted', async () => {
  fakes.state.record = { ...RECORD, vapid_key_id: 'oldkey0000000000' };
  const hold = gate();
  const rotating = refreshPush({
    companyId: 'company',
    locale: 'en',
    config: fakes.state.config,
    installationId: INSTALLATION,
  });
  await hold.reached;

  const disabling = disablePush(INSTALLATION);
  hold.release();
  await rotating;
  await disabling;

  expect(fakes.state.record).toBeNull();
  expect(fakes.state.removed).toBe(1);
});

it('a refresh queued before an enable does not send the old token with the new subscription', async () => {
  const hold = gate();
  const refreshing = refreshPush({
    companyId: 'company',
    locale: 'en',
    config: fakes.state.config,
    installationId: INSTALLATION,
  });
  await hold.reached;

  const enabling = enablePush({
    companyId: 'company',
    locale: 'en',
    installationId: INSTALLATION,
    onRegistered: () => undefined,
  });
  hold.release();
  await refreshing;
  await enabling;

  expect(fakes.state.registers[0]).toEqual({ token: 'delivery-token', endpoint: FIRST });
  expect(fakes.state.registers[1]?.token).not.toBe('delivery-token');
  expect(fakes.state.registers[1]?.endpoint).toBe(SECOND);
});

it('runs the work one at a time when the browser has no locks', async () => {
  withoutLocks();
  const order: string[] = [];

  const first = runPushExclusive(async () => {
    order.push('first-start');
    await new Promise((resolve) => setTimeout(resolve, 5));
    order.push('first-end');
    return 'first';
  });
  const second = runPushExclusive(async () => {
    order.push('second-start');
    return 'second';
  });

  await expect(first).resolves.toBe('first');
  await expect(second).resolves.toBe('second');
  expect(order).toEqual(['first-start', 'first-end', 'second-start']);
});

it('keeps the queue going after a failure', async () => {
  withoutLocks();

  await expect(
    runPushExclusive(async () => {
      throw new Error('SYNTHETIC_FAILURE');
    }),
  ).rejects.toThrow('SYNTHETIC_FAILURE');
  await expect(runPushExclusive(async () => 'after')).resolves.toBe('after');
});
