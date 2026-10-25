import { beforeEach, expect, it, vi } from 'vitest';

import { pushCalls } from './push-calls';
import { disablePush } from './push-disable';
import { enablePush } from './push-enable';
import { refreshPush } from './push-refresh';
import type { PushRecord, PushWriteOptions } from './push-record';

const INSTALLATION = '12345678-1234-4234-8234-123456789abc';
const OWN = 'test-own-a';
const OLD_VAPID = 'oldkey0000000000';
const NEW_VAPID = '0123456789abcdef';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/existing';

const CONFIG = {
  vapid_public_key: 'public-key',
  vapid_key_id: NEW_VAPID,
  subscriber_ref: 'subscriber-ref',
  company_id: 'company',
};

const RECORD: PushRecord = {
  token: OWN,
  subscriber_ref: 'subscriber-ref',
  company_id: 'company',
  vapid_key_id: OLD_VAPID,
  suspended: false,
  revision: 0,
};

const fakes = vi.hoisted(() => ({
  record: null as PushRecord | null,
  readThrows: false,
  casThrows: false,
  removed: 0,
  generation: 0,
  unsubscribes: 0,
  revokes: 0,
  subscribed: false,
}));

vi.mock('./push-record-events', () => ({ notifyPushRecordChanged: vi.fn() }));

vi.mock('./push-record-idb', () => ({
  pushRecordStore: {
    read: async () => {
      if (fakes.readThrows) throw new Error('PUSH_STORE_UNAVAILABLE');
      return fakes.record === null ? null : { ...fakes.record };
    },
    write: async (record: PushRecord) => {
      fakes.record = record;
    },
    remove: async () => {
      if (fakes.casThrows) throw new Error('PUSH_STORE_UNAVAILABLE');
      fakes.removed += 1;
      fakes.record = null;
    },
    removeIfMatches: async (expected: { token: string | null; revision: number }) => {
      if (fakes.casThrows) throw new Error('PUSH_STORE_UNAVAILABLE');
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
    suspend: async () => null,
    generation: async () => fakes.generation,
    bumpGeneration: async () => {
      fakes.generation += 1;
      return fakes.generation;
    },
    writeIfGeneration: async (record: PushRecord, expected: number, options?: PushWriteOptions) => {
      if (fakes.casThrows) throw new Error('PUSH_STORE_UNAVAILABLE');
      const stored = fakes.record;
      const revision = stored?.revision ?? 0;
      if (fakes.generation !== expected) return false;
      if (options?.expectRevision !== undefined && revision !== options.expectRevision)
        return false;
      if (options?.expectToken !== undefined && (stored?.token ?? null) !== options.expectToken) {
        return false;
      }
      const clear = options?.clearSuspension === true;
      const suspended = stored?.suspended === true && !clear;
      fakes.record = suspended ? { ...record, suspended: true } : record;
      return true;
    },
  },
}));

function fakeSubscription() {
  return {
    endpoint: ENDPOINT,
    unsubscribe: async () => true,
    toJSON: () => ({
      endpoint: ENDPOINT,
      expirationTime: null,
      keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
    }),
  };
}

vi.mock('./push-browser', () => ({
  base64UrlToBytes: () => new Uint8Array([1, 2, 3]),
  currentSubscription: async () => (fakes.subscribed ? fakeSubscription() : null),
  notificationPermission: () => 'granted' as const,
  pushSubscriptionBody: (subscription: { endpoint: string }) => ({
    endpoint: subscription.endpoint,
    expirationTime: null,
    keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
  }),
  requestNotificationPermission: async () => 'granted' as const,
  subscribeWithDeadline: async () => fakeSubscription(),
  unsubscribePush: vi.fn(async () => {
    fakes.unsubscribes += 1;
    return true;
  }),
}));

vi.mock('./push-calls', () => ({
  pushCalls: {
    config: vi.fn(async () => ({ kind: 'ready' as const, config: CONFIG })),
    register: vi.fn(async () => undefined),
    revoke: vi.fn(async () => {
      fakes.revokes += 1;
    }),
  },
  PushKeyStaleError: class PushKeyStaleError extends Error {},
  withTimeout: <T>(promise: Promise<T>) => promise,
  withAbortTimeout: <T>(run: (signal: AbortSignal) => Promise<T>) =>
    run(new AbortController().signal),
}));

/** قفل Web Locks حقيقي في الذاكرة: كل اسم قفل له طابور مستقل. */
function stubBrowserWithLock(): void {
  const chains = new Map<string, Promise<unknown>>();
  vi.stubGlobal('navigator', {
    onLine: true,
    locks: {
      request: (name: string, work: () => Promise<unknown>) => {
        const previous = chains.get(name) ?? Promise.resolve();
        const run = previous.then(work, work);
        chains.set(
          name,
          run.then(
            () => undefined,
            () => undefined,
          ),
        );
        return run;
      },
    },
  });
}

interface MatrixCase {
  action: 'enable' | 'disable' | 'refresh';
  failure: 'read' | 'cas';
  snapshot?: boolean;
  expected: unknown;
  unsubscribes?: number;
  revokes?: number;
  removed?: number;
  registers?: number;
}

const CASES: MatrixCase[] = [
  { action: 'enable', failure: 'read', expected: { kind: 'failed' } },
  { action: 'enable', failure: 'cas', expected: { kind: 'failed' }, registers: 1 },
  { action: 'disable', failure: 'read', snapshot: true, expected: 'failed' },
  { action: 'disable', failure: 'cas', snapshot: true, expected: 'failed' },
  { action: 'disable', failure: 'cas', expected: 'failed' },
  { action: 'refresh', failure: 'read', expected: { kind: 'none' } },
  {
    action: 'refresh',
    failure: 'cas',
    expected: { kind: 'none' },
    unsubscribes: 1,
    registers: 1,
  },
];

function prepareFor(action: MatrixCase['action']): void {
  fakes.record = action === 'enable' ? null : { ...RECORD };
  fakes.subscribed = action === 'refresh';
}

async function runAction(action: MatrixCase['action'], snapshot: boolean): Promise<unknown> {
  if (action === 'enable') {
    return enablePush({
      companyId: 'company',
      locale: 'en',
      installationId: INSTALLATION,
      onRegistered: () => undefined,
    });
  }
  if (action === 'disable') {
    return disablePush(INSTALLATION, snapshot ? { token: OWN, revision: 0 } : null);
  }
  return refreshPush({
    companyId: 'company',
    locale: 'en',
    config: CONFIG,
    installationId: INSTALLATION,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.record = null;
  fakes.readThrows = false;
  fakes.casThrows = false;
  fakes.removed = 0;
  fakes.generation = 0;
  fakes.unsubscribes = 0;
  fakes.revokes = 0;
  fakes.subscribed = false;
  stubBrowserWithLock();
});

it.each(CASES)('the $action touches nothing when the store $failure fails', async (testCase) => {
  prepareFor(testCase.action);
  if (testCase.failure === 'read') fakes.readThrows = true;
  else fakes.casThrows = true;

  const outcome = await runAction(testCase.action, testCase.snapshot === true);

  expect(outcome).toEqual(testCase.expected);
  expect(fakes.unsubscribes).toBe(testCase.unsubscribes ?? 0);
  expect(fakes.revokes).toBe(testCase.revokes ?? 0);
  expect(fakes.removed).toBe(testCase.removed ?? 0);
  expect(vi.mocked(pushCalls.register)).toHaveBeenCalledTimes(testCase.registers ?? 0);
});

it('the disable removes the record and the subscription when the store is healthy', async () => {
  fakes.record = { ...RECORD };

  const outcome = await disablePush(INSTALLATION, { token: OWN, revision: 0 });

  expect(outcome).toBe('disabled');
  expect(fakes.removed).toBe(1);
  expect(fakes.unsubscribes).toBe(1);
  expect(fakes.revokes).toBe(1);
});

it('the enable writes the record when the store is healthy', async () => {
  const outcome = await enablePush({
    companyId: 'company',
    locale: 'en',
    installationId: INSTALLATION,
    onRegistered: () => undefined,
  });

  expect(outcome.kind).toBe('enabled');
  expect(fakes.record?.token).not.toBe(OWN);
  expect(fakes.unsubscribes).toBe(0);
});

it('the refresh rotates the record when the store is healthy', async () => {
  fakes.record = { ...RECORD };
  fakes.subscribed = true;

  const outcome = await refreshPush({
    companyId: 'company',
    locale: 'en',
    config: CONFIG,
    installationId: INSTALLATION,
  });

  expect(outcome.kind).toBe('rotated');
  expect(fakes.record?.vapid_key_id).toBe(NEW_VAPID);
  expect(fakes.unsubscribes).toBe(1);
});
