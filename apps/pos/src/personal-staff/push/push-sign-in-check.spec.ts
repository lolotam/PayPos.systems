import { beforeEach, expect, it, vi } from 'vitest';
import type { PushConfig } from '@pospay/contracts';

import { pushCalls, type PushConfigResult } from './push-calls';
import type { PushRecord } from './push-record';
import { runSignInPushCheck } from './push-sign-in-check';

const fakes = vi.hoisted(() => {
  const state = {
    record: null as PushRecord | null,
    writes: [] as PushRecord[],
    removed: 0,
    unsubscribed: 0,
    writesBeforeConfig: 0,
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
      fakes.state.record = record;
      fakes.state.writes.push(record);
    },
    remove: async () => {
      fakes.state.removed += 1;
      fakes.state.record = null;
    },
  },
}));

vi.mock('./push-browser', () => ({
  unsubscribePush: async () => {
    fakes.state.unsubscribed += 1;
    return true;
  },
}));

vi.mock('./push-calls', () => ({
  pushCalls: { config: vi.fn(), register: vi.fn(), revoke: vi.fn() },
  withTimeout: <T>(promise: Promise<T>) => promise,
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
  fakes.state.record = { ...RECORD };
  fakes.state.writes = [];
  fakes.state.removed = 0;
  fakes.state.unsubscribed = 0;
  fakes.state.writesBeforeConfig = 0;
  vi.mocked(pushCalls.config).mockImplementation(async () => {
    fakes.state.writesBeforeConfig = fakes.state.writes.length;
    return { kind: 'ready', config: CONFIG };
  });
});

it('suspends the record before it compares the subscriber reference', async () => {
  await runSignInPushCheck();

  expect(fakes.state.writesBeforeConfig).toBe(1);
  expect(fakes.state.writes[0]).toEqual({ ...RECORD, suspended: true });
});

it('restores the record when the subscriber reference is the same', async () => {
  await runSignInPushCheck();

  expect(fakes.state.record?.suspended).toBe(false);
  expect(fakes.state.removed).toBe(0);
});

it('deletes the record and unsubscribes when the subscriber reference is another person', async () => {
  vi.mocked(pushCalls.config).mockResolvedValue({
    kind: 'ready',
    config: { ...CONFIG, subscriber_ref: 'another-ref' },
  });

  await runSignInPushCheck();

  expect(fakes.state.removed).toBe(1);
  expect(fakes.state.unsubscribed).toBe(1);
  expect(fakes.state.record).toBeNull();
});

it('keeps the record suspended when the comparison fails', async () => {
  vi.mocked(pushCalls.config).mockRejectedValue(new Error('PUSH_CONFIG_REFUSED'));

  await runSignInPushCheck();

  expect(fakes.state.record?.suspended).toBe(true);
  expect(fakes.state.removed).toBe(0);
});

it('keeps the record suspended when the service is not ready', async () => {
  vi.mocked(pushCalls.config).mockResolvedValue({ kind: 'not-ready' });

  await runSignInPushCheck();

  expect(fakes.state.record?.suspended).toBe(true);
  expect(fakes.state.removed).toBe(0);
});

it('ignores the answer of an older run', async () => {
  const first = deferred<PushConfigResult>();
  const second = deferred<PushConfigResult>();
  vi.mocked(pushCalls.config)
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise);

  const older = runSignInPushCheck();
  const newer = runSignInPushCheck();
  second.resolve({ kind: 'ready', config: CONFIG });
  await newer;
  expect(fakes.state.record?.suspended).toBe(false);

  first.resolve({ kind: 'ready', config: { ...CONFIG, subscriber_ref: 'another-ref' } });
  await older;

  expect(fakes.state.removed).toBe(0);
  expect(fakes.state.record?.suspended).toBe(false);
});

it('does nothing when the phone holds no record', async () => {
  fakes.state.record = null;

  await runSignInPushCheck();

  expect(pushCalls.config).not.toHaveBeenCalled();
  expect(fakes.state.writes).toHaveLength(0);
});
