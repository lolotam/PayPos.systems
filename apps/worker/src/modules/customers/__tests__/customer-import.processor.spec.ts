import type { ClaimedEvent } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  order: [] as string[],
  upsertJobScheduler: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {
    state.order.push('upsertJobScheduler');
  }),
  add: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {
    state.order.push('add');
  }),
  handlers: new Map<string, (job: unknown, token?: string) => Promise<void>>(),
  failedListeners: new Map<string, (job: unknown) => void>(),
  DelayedErrorClass: class DelayedError extends Error {},
}));

vi.mock('ioredis', () => ({
  Redis: class MockRedis {
    on() {
      return this;
    }
    duplicate() {
      return { on: vi.fn(), disconnect: vi.fn() };
    }
    disconnect = vi.fn();
  },
}));

vi.mock('bullmq', () => ({
  DelayedError: state.DelayedErrorClass,
  Queue: class MockQueue {
    on() {
      return this;
    }
    upsertJobScheduler = (...args: unknown[]) => state.upsertJobScheduler(...args);
    add = (...args: unknown[]) => state.add(...args);
    close = vi.fn(async () => undefined);
  },
  Worker: class MockWorker {
    constructor(
      readonly name: string,
      processor: (job: unknown, token?: string) => Promise<void>,
    ) {
      state.handlers.set(name, processor);
    }
    on(event: string, listener: (job: unknown) => void) {
      if (event === 'failed') state.failedListeners.set(this.name, listener);
      return this;
    }
    waitUntilReady = vi.fn(async () => undefined);
    close = vi.fn(async () => undefined);
  },
}));

import {
  CUSTOMER_IMPORT_COMMIT_QUEUE,
  CUSTOMER_IMPORT_RECOVERY_QUEUE,
  startCustomerImportProcessor,
} from '../jobs/customer-import.processor.ts';
import type {
  CommitCustomerImport,
  RecoverCustomerImports,
} from '../use-cases/commit-customer-import/commit-customer-import.ts';

const ids = systemUuidV7();
const validEvent = (overrides: Partial<ClaimedEvent> = {}): ClaimedEvent => {
  const previewId = ids.newId();
  return {
    id: ids.newId(),
    companyId: ids.newId(),
    aggregateType: 'import_preview',
    aggregateId: previewId,
    eventType: 'CustomerImportCommitRequested',
    payload: { preview_id: previewId },
    attempt: 1,
    ...overrides,
  };
};

beforeEach(() => {
  state.order = [];
  state.upsertJobScheduler.mockReset().mockImplementation(async () => {
    state.order.push('upsertJobScheduler');
  });
  state.add.mockReset().mockImplementation(async () => {
    state.order.push('add');
  });
  state.handlers.clear();
  state.failedListeners.clear();
});

function createProcessor() {
  const execute = vi.fn(async () => undefined);
  const fail = vi.fn(async () => undefined);
  const recover = vi.fn(async () => undefined);
  const processor = startCustomerImportProcessor(
    { execute, fail } as unknown as CommitCustomerImport,
    { execute: recover } as unknown as RecoverCustomerImports,
    'redis://127.0.0.1:6379',
    'test-prefix',
  );
  return { processor, execute, fail, recover };
}

it('rejects malformed or mismatched events without scheduling recovery or enqueueing a commit', async () => {
  const { processor } = createProcessor();
  const wrongAggregate = validEvent({ aggregateType: 'customer' });
  const mismatchedPayload = validEvent({ payload: { preview_id: ids.newId() } });

  expect(await processor.deliver(wrongAggregate)).toEqual({
    delivered: false,
    error: 'CUSTOMER_IMPORT_COMMIT_EVENT_INVALID',
    retryInMs: null,
  });
  expect(await processor.deliver(mismatchedPayload)).toEqual({
    delivered: false,
    error: 'CUSTOMER_IMPORT_COMMIT_EVENT_INVALID',
    retryInMs: null,
  });
  expect(state.upsertJobScheduler).not.toHaveBeenCalled();
  expect(state.add).not.toHaveBeenCalled();
  await processor.close();
});

it('registers the recovery schedule before enqueueing the commit job and returns retry on queue errors', async () => {
  const { processor } = createProcessor();
  const event = validEvent();

  expect(await processor.deliver(event)).toEqual({ delivered: true });
  expect(state.order).toEqual(['upsertJobScheduler', 'add']);
  expect(state.upsertJobScheduler).toHaveBeenCalledWith(
    `${CUSTOMER_IMPORT_RECOVERY_QUEUE}-${event.companyId}`,
    { every: 60_000 },
    expect.objectContaining({ name: 'recover', data: { companyId: event.companyId } }),
  );
  expect(state.add).toHaveBeenCalledWith(
    'commit',
    { companyId: event.companyId, previewId: event.aggregateId },
    expect.objectContaining({ jobId: event.id, attempts: 4 }),
  );

  state.add.mockRejectedValueOnce(new Error('redis down'));
  expect(await processor.deliver(event)).toEqual({
    delivered: false,
    error: 'CUSTOMER_IMPORT_COMMIT_QUEUE_RETRY',
    retryInMs: 2000,
  });
  await processor.close();
});

it('rethrows transient errors, persists failure on final attempt, delays when fail fails, and handles failed events', async () => {
  const { processor, execute, fail } = createProcessor();
  const handler = state.handlers.get(CUSTOMER_IMPORT_COMMIT_QUEUE);
  const failedListener = state.failedListeners.get(CUSTOMER_IMPORT_COMMIT_QUEUE);
  const companyId = ids.newId();
  const previewId = ids.newId();

  execute.mockRejectedValueOnce(new Error('transient'));
  await expect(
    handler?.({ data: { companyId, previewId }, attemptsMade: 0, opts: { attempts: 4 }, progress: null }),
  ).rejects.toThrow('transient');
  expect(fail).not.toHaveBeenCalled();

  const updateProgress = vi.fn(async () => undefined);
  const moveToDelayed = vi.fn(async () => undefined);
  execute.mockRejectedValueOnce(new Error('transient'));
  fail.mockRejectedValueOnce(new Error('db busy'));
  await expect(
    handler?.(
      {
        data: { companyId, previewId },
        attemptsMade: 3,
        opts: { attempts: 4 },
        progress: null,
        updateProgress,
        moveToDelayed,
      },
      'lock-token',
    ),
  ).rejects.toBeInstanceOf(state.DelayedErrorClass);
  expect(updateProgress).toHaveBeenCalledWith({
    stage: 'finalizing-customer-import-commit-failure',
  });
  expect(moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'lock-token');

  fail.mockResolvedValue(undefined);
  await handler?.({
    data: { companyId, previewId },
    attemptsMade: 1,
    opts: { attempts: 4 },
    progress: { stage: 'finalizing-customer-import-commit-failure' },
  });
  expect(fail).toHaveBeenCalledWith(companyId, previewId);

  fail.mockClear();
  failedListener?.({ data: { companyId, previewId }, finishedOn: 123456 });
  failedListener?.({ data: { companyId, previewId }, finishedOn: undefined });
  expect(fail).toHaveBeenCalledTimes(1);
  expect(fail).toHaveBeenCalledWith(companyId, previewId);
  await processor.close();
});
