import { beforeEach, expect, it, vi } from 'vitest';
import type { PushConfig } from '@pospay/contracts';

import { pushCalls, type PushConfigResult } from './push-calls';
import type { PushRecord, PushWriteOptions } from './push-record';
import { runSignInPushCheck, suspendPushForSignIn } from './push-sign-in-check';

const fakes = vi.hoisted(() => {
  const state = {
    record: null as PushRecord | null,
    writes: [] as PushRecord[],
    removed: 0,
    unsubscribed: 0,
    writesBeforeConfig: 0,
    writeFails: false,
    duringSuspend: undefined as PushRecord | null | undefined,
    generationDuringSuspend: undefined as number | undefined,
    generation: 0,
  };
  return { state };
});

const RECORD: PushRecord = {
  token: 'delivery-token',
  subscriber_ref: 'subscriber-ref',
  company_id: 'company',
  vapid_key_id: '0123456789abcdef',
  suspended: false,
  revision: 0,
};

const CONFIG: PushConfig = {
  vapid_public_key: 'public-key',
  vapid_key_id: '0123456789abcdef',
  subscriber_ref: 'subscriber-ref',
};
const NEWER = 'test-newer-c';

async function writeIfGeneration(
  record: PushRecord,
  expected: number,
  options?: PushWriteOptions,
): Promise<boolean> {
  if (fakes.state.generation !== expected) return false;
  const stored = fakes.state.record;
  const revisionMatches =
    options?.expectRevision === undefined || (stored?.revision ?? 0) === options.expectRevision;
  const tokenMatches =
    options?.expectToken === undefined || (stored?.token ?? null) === options.expectToken;
  if (!revisionMatches || !tokenMatches) return false;
  const clear = options?.clearSuspension === true;
  const suspended = stored?.suspended === true && !clear;
  fakes.state.record = suspended ? { ...record, suspended: true } : record;
  fakes.state.writes.push(fakes.state.record);
  return true;
}

vi.mock('./push-record-idb', () => ({
  pushRecordStore: {
    read: async () => (fakes.state.record === null ? null : { ...fakes.state.record }),
    write: async (record: PushRecord) => {
      if (fakes.state.writeFails) throw new Error('PUSH_STORE_UNAVAILABLE');
      fakes.state.record = record;
      fakes.state.writes.push(record);
    },
    suspend: async () => {
      if (fakes.state.writeFails) throw new Error('PUSH_STORE_UNAVAILABLE');
      const bump = fakes.state.generationDuringSuspend;
      if (bump !== undefined) {
        fakes.state.generation = bump;
        fakes.state.generationDuringSuspend = undefined;
      }
      if (fakes.state.duringSuspend !== undefined) {
        fakes.state.record = fakes.state.duringSuspend;
        fakes.state.duringSuspend = undefined;
      }
      const stored = fakes.state.record;
      if (stored === null) return null;
      const suspended = { ...stored, suspended: true, revision: stored.revision + 1 };
      fakes.state.record = suspended;
      fakes.state.writes.push(suspended);
      return { record: suspended, generation: fakes.state.generation };
    },
    remove: async () => {
      fakes.state.removed += 1;
      fakes.state.record = null;
    },
    removeIfMatches: async (expected: { token: string | null; revision: number }) => {
      const stored = fakes.state.record;
      if (
        stored === null ||
        stored.token !== expected.token ||
        stored.revision !== expected.revision
      ) {
        return false;
      }
      fakes.state.removed += 1;
      fakes.state.record = null;
      return true;
    },
    generation: async () => fakes.state.generation,
    bumpGeneration: async () => {
      fakes.state.generation += 1;
      return fakes.state.generation;
    },
    writeIfGeneration,
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
  fakes.state.record = { ...RECORD };
  fakes.state.writes = [];
  fakes.state.removed = 0;
  fakes.state.unsubscribed = 0;
  fakes.state.writesBeforeConfig = 0;
  fakes.state.writeFails = false;
  fakes.state.duringSuspend = undefined;
  fakes.state.generationDuringSuspend = undefined;
  fakes.state.generation = 0;
  vi.mocked(pushCalls.config).mockImplementation(async () => {
    fakes.state.writesBeforeConfig = fakes.state.writes.length;
    return { kind: 'ready', config: CONFIG };
  });
});

it('suspends the record before it compares the subscriber reference', async () => {
  await runSignInPushCheck();

  expect(fakes.state.writesBeforeConfig).toBe(1);
  expect(fakes.state.writes[0]).toEqual({ ...RECORD, suspended: true, revision: 1 });
});

it('increments the revision and keeps a token written by another tab', async () => {
  await suspendPushForSignIn();
  fakes.state.duringSuspend = { ...RECORD, token: 'new-token', revision: 1 };
  await suspendPushForSignIn();

  expect(fakes.state.record?.revision).toBe(2);
  expect(fakes.state.record?.token).toBe('new-token');
  expect(fakes.state.record?.suspended).toBe(true);
});

it('restores the record when the subscriber reference is the same', async () => {
  await runSignInPushCheck();

  expect(fakes.state.record?.suspended).toBe(false);
  expect(fakes.state.removed).toBe(0);
});

it('keeps a newer suspension from another tab when the reference matches', async () => {
  const pending = deferred<PushConfigResult>();
  const started = deferred<undefined>();
  vi.mocked(pushCalls.config).mockImplementation(() => {
    started.resolve(undefined);
    return pending.promise;
  });

  const checking = runSignInPushCheck();
  await started.promise;
  expect(fakes.state.record?.revision).toBe(1);
  await suspendPushForSignIn();
  pending.resolve({ kind: 'ready', config: CONFIG });
  await checking;

  expect(fakes.state.record).toEqual({ ...RECORD, suspended: true, revision: 2 });
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
  first.resolve({ kind: 'ready', config: { ...CONFIG, subscriber_ref: 'another-ref' } });
  await older;
  second.resolve({ kind: 'ready', config: CONFIG });
  await newer;

  expect(fakes.state.removed).toBe(0);
  expect(fakes.state.record?.suspended).toBe(false);
});

it('writes nothing when another tab removes the record before suspension', async () => {
  fakes.state.duringSuspend = null;

  await runSignInPushCheck();

  // التعليق رجع null: مفيش سجل اتعلّق، فمفيش مقارنة ومفيش كتابة ولا مسح.
  expect(pushCalls.config).not.toHaveBeenCalled();
  expect(fakes.state.record).toBeNull();
  expect(fakes.state.writes).toHaveLength(0);
  expect(fakes.state.removed).toBe(0);
});

it('suspends a record that appears while the sign-in is running', async () => {
  fakes.state.record = null;
  fakes.state.duringSuspend = { ...RECORD };

  await suspendPushForSignIn();

  expect(fakes.state.record).toEqual({ ...RECORD, suspended: true, revision: 1 });
  expect(fakes.state.writes).toHaveLength(1);
});

it('restores the record another tab wrote when the subscriber reference matches', async () => {
  fakes.state.duringSuspend = { ...RECORD, token: NEWER };

  await runSignInPushCheck();

  expect(fakes.state.record?.token).toBe(NEWER);
  expect(fakes.state.record?.suspended).toBe(false);
  expect(fakes.state.removed).toBe(0);
  expect(fakes.state.unsubscribed).toBe(0);
});

it('removes the record another tab wrote when the subscriber reference differs', async () => {
  fakes.state.duringSuspend = { ...RECORD, token: NEWER };
  vi.mocked(pushCalls.config).mockResolvedValue({
    kind: 'ready',
    config: { ...CONFIG, subscriber_ref: 'another-ref' },
  });

  await runSignInPushCheck();

  expect(fakes.state.record).toBeNull();
  expect(fakes.state.removed).toBe(1);
  expect(fakes.state.unsubscribed).toBe(1);
});

it('restores a replacement record when another tab bumped the generation', async () => {
  // تبويب تاني كسر الجيل وكتب سجل بديل قبل التعليق: الرجوع المحروس لازم يستعمل
  // الجيل اللي رجع مع التعليق، مش الجيل المقروء قبله.
  fakes.state.duringSuspend = { ...RECORD, token: NEWER };
  fakes.state.generationDuringSuspend = 1;

  await runSignInPushCheck();

  expect(fakes.state.record?.token).toBe(NEWER);
  expect(fakes.state.record?.suspended).toBe(false);
  expect(fakes.state.removed).toBe(0);
  expect(fakes.state.unsubscribed).toBe(0);
});

it('leaves a newer record alone when the comparison finishes', async () => {
  vi.mocked(pushCalls.config).mockImplementation(async () => {
    fakes.state.record = { ...RECORD, token: 'newer-token' };
    return { kind: 'ready', config: CONFIG };
  });

  await runSignInPushCheck();

  expect(fakes.state.record?.token).toBe('newer-token');
  expect(fakes.state.record?.suspended).toBe(false);
  expect(fakes.state.removed).toBe(0);
});

it('does not delete a newer record when the subscriber reference differs', async () => {
  vi.mocked(pushCalls.config).mockImplementation(async () => {
    fakes.state.record = { ...RECORD, token: 'newer-token' };
    return { kind: 'ready', config: { ...CONFIG, subscriber_ref: 'another-ref' } };
  });

  await runSignInPushCheck();

  expect(fakes.state.removed).toBe(0);
  expect(fakes.state.unsubscribed).toBe(0);
  expect(fakes.state.record?.token).toBe('newer-token');
});

it('removes the record and stops when the suspend write fails', async () => {
  fakes.state.writeFails = true;

  await runSignInPushCheck();

  expect(fakes.state.removed).toBe(1);
  expect(fakes.state.unsubscribed).toBe(1);
  expect(fakes.state.record).toBeNull();
  expect(pushCalls.config).not.toHaveBeenCalled();
});

it('suspends the record before the session changes', async () => {
  await suspendPushForSignIn();

  expect(fakes.state.writes[0]).toEqual({ ...RECORD, suspended: true, revision: 1 });
  expect(pushCalls.config).not.toHaveBeenCalled();
});

it('removes the record and the subscription when the suspend write fails', async () => {
  fakes.state.writeFails = true;

  await suspendPushForSignIn();

  expect(fakes.state.removed).toBe(1);
  expect(fakes.state.unsubscribed).toBe(1);
  expect(fakes.state.record).toBeNull();
});
