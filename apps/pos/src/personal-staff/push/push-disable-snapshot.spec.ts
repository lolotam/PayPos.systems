import { beforeEach, expect, it, vi } from 'vitest';

import { unsubscribePush } from './push-browser';
import { pushCalls } from './push-calls';
import { disablePush } from './push-disable';
import type { PushRecord } from './push-record';

const INSTALLATION = '12345678-1234-4234-8234-123456789abc';
const OWN = 'test-own-a';
const OTHER = 'test-other-b';

const fakes = vi.hoisted(() => ({
  record: null as PushRecord | null,
  generation: 0,
  removed: 0,
}));

const RECORD: PushRecord = {
  token: OWN,
  subscriber_ref: 'subscriber-ref',
  company_id: 'company',
  vapid_key_id: '0123456789abcdef',
  suspended: false,
  revision: 0,
};

vi.mock('./push-record-events', () => ({ notifyPushRecordChanged: vi.fn() }));

vi.mock('./push-record-idb', () => ({
  pushRecordStore: {
    read: async () => (fakes.record === null ? null : { ...fakes.record }),
    write: async (record: PushRecord) => {
      fakes.record = record;
    },
    remove: async () => {
      fakes.removed += 1;
      fakes.record = null;
    },
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
    suspend: async () => null,
    generation: async () => fakes.generation,
    bumpGeneration: async () => {
      fakes.generation += 1;
      return fakes.generation;
    },
    writeIfGeneration: async () => true,
  },
}));

vi.mock('./push-browser', () => ({
  unsubscribePush: vi.fn(async () => true),
}));

vi.mock('./push-calls', () => ({
  pushCalls: { config: vi.fn(), register: vi.fn(), revoke: vi.fn() },
  withTimeout: <T>(promise: Promise<T>) => promise,
  withAbortTimeout: <T>(run: (signal: AbortSignal) => Promise<T>) =>
    run(new AbortController().signal),
}));

beforeEach(() => {
  vi.clearAllMocks();
  fakes.record = { ...RECORD };
  fakes.generation = 0;
  fakes.removed = 0;
  vi.mocked(pushCalls.revoke).mockResolvedValue(undefined);
});

it('leaves a record another tab wrote untouched', async () => {
  fakes.record = { ...RECORD, token: OTHER };

  await disablePush(INSTALLATION, { token: OWN, revision: 0 });

  expect(fakes.record?.token).toBe(OTHER);
  expect(fakes.removed).toBe(0);
  expect(fakes.generation).toBe(0);
  expect(unsubscribePush).not.toHaveBeenCalled();
  expect(pushCalls.revoke).not.toHaveBeenCalled();
});

it('removes the record when the shown snapshot still matches', async () => {
  await disablePush(INSTALLATION, { token: OWN, revision: 0 });

  expect(fakes.record).toBeNull();
  expect(fakes.removed).toBe(1);
  expect(fakes.generation).toBe(1);
  expect(unsubscribePush).toHaveBeenCalledTimes(1);
  expect(pushCalls.revoke).toHaveBeenCalledWith(INSTALLATION, expect.any(AbortSignal));
});

it('leaves a record that appeared after the empty snapshot untouched', async () => {
  await disablePush(INSTALLATION, { token: null, revision: 0 });

  expect(fakes.record?.token).toBe(OWN);
  expect(fakes.removed).toBe(0);
  expect(fakes.generation).toBe(0);
  expect(unsubscribePush).not.toHaveBeenCalled();
  expect(pushCalls.revoke).not.toHaveBeenCalled();
});
