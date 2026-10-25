import { beforeEach, expect, it, vi } from 'vitest';

import { newerRecordHoldsSubscription } from './push-newer-record';
import type { PushRecord, PushRecordStore } from './push-record';

const RECORD: PushRecord = {
  token: 'delivery-token',
  subscriber_ref: 'subscriber-ref',
  company_id: 'company',
  vapid_key_id: '0123456789abcdef',
  suspended: false,
  revision: 0,
};

const fakes = vi.hoisted(() => ({
  record: null as PushRecord | null,
  readFails: false,
}));

vi.mock('./push-record-idb', () => ({
  pushRecordStore: {
    read: async () => {
      if (fakes.readFails) throw new Error('PUSH_STORE_UNAVAILABLE');
      const stored = fakes.record;
      return stored === null ? null : { ...stored };
    },
    write: async () => undefined,
    remove: async () => undefined,
    removeIfMatches: async () => false,
    suspend: async () => null,
    generation: async () => 0,
    bumpGeneration: async () => 1,
    writeIfGeneration: async () => true,
  } satisfies PushRecordStore,
}));

beforeEach(() => {
  vi.clearAllMocks();
  fakes.record = null;
  fakes.readFails = false;
});

it('says the subscription belongs to another registration when the stored token differs', async () => {
  fakes.record = { ...RECORD, token: 'winner-token' };

  expect(await newerRecordHoldsSubscription('delivery-token')).toBe(true);
});

it('says the record is still ours when the token did not change', async () => {
  fakes.record = { ...RECORD, suspended: true, revision: 3 };

  expect(await newerRecordHoldsSubscription(RECORD.token)).toBe(false);
});

it('says another registration won when there was no record before and one is stored now', async () => {
  fakes.record = { ...RECORD };

  expect(await newerRecordHoldsSubscription(null)).toBe(true);
});

it('says nobody owns the subscription when there is no record', async () => {
  fakes.record = null;

  expect(await newerRecordHoldsSubscription(RECORD.token)).toBe(false);
});

it('says nobody owns the subscription when the record cannot be read', async () => {
  fakes.readFails = true;

  expect(await newerRecordHoldsSubscription(RECORD.token)).toBe(false);
});
