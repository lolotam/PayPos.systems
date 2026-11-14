import { DelayedError } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import type { ClaimedEvent } from '@pospay/db';
import { startServiceCategoryClosingProcessor } from './service-category-closing.processor.ts';
import type { RunServiceCategoryClosing } from '../use-cases/run-service-category-closing/run-service-category-closing.ts';

const state = vi.hoisted(() => ({
  queues: [] as {
    name: string;
    add: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }[],
  workers: [] as {
    name: string;
    handler: (job: never, token?: string) => Promise<unknown>;
    waitUntilReady: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }[],
  failed: [] as ((job: never) => void)[],
}));

vi.mock('bullmq', () => ({
  Queue: class {
    add = vi.fn();
    close = vi.fn(async () => undefined);
    on = vi.fn();
    constructor(readonly name: string) {
      state.queues.push(this);
    }
  },
  Worker: class {
    waitUntilReady = vi.fn(async () => undefined);
    close = vi.fn(async () => undefined);
    on = vi.fn((event: string, listener: (job: never) => void) => {
      if (event === 'failed') state.failed.push(listener);
    });
    constructor(
      readonly name: string,
      readonly handler: (job: never, token?: string) => Promise<unknown>,
    ) {
      state.workers.push(this);
    }
  },
  DelayedError: class DelayedError extends Error {},
}));

vi.mock('ioredis', () => ({
  Redis: class {
    duplicate() {
      return this;
    }
    on() {}
    disconnect() {}
  },
}));

const ids = systemUuidV7();

beforeEach(() => {
  state.queues.length = 0;
  state.workers.length = 0;
  state.failed.length = 0;
});

function event(overrides: Partial<ClaimedEvent> = {}): ClaimedEvent {
  const closingId = ids.newId();
  return {
    id: ids.newId(),
    companyId: ids.newId(),
    aggregateId: closingId,
    aggregateType: 'service_category_closing',
    eventType: 'ServiceCategoryClosingRequested',
    payload: { closing_id: closingId },
    attempt: 1,
    ...overrides,
  };
}

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error('EXPECTED_CLOSING_PROCESSOR_DOUBLE');
  return value;
}

function start(
  overrides: { execute?: ReturnType<typeof vi.fn>; fail?: ReturnType<typeof vi.fn> } = {},
) {
  const execute = overrides.execute ?? vi.fn(async () => undefined);
  const fail = overrides.fail ?? vi.fn(async () => undefined);
  const processor = startServiceCategoryClosingProcessor(
    { execute, fail } as unknown as RunServiceCategoryClosing,
    'synthetic',
  );
  return { processor, execute, fail, queue: first(state.queues) };
}

describe('delivery', () => {
  it('enqueues a valid event by event id and returns delivered', async () => {
    const { processor, queue } = start();
    const claimed = event();
    expect(await processor.deliver(claimed)).toEqual({ delivered: true });
    expect(queue.add).toHaveBeenCalledWith(
      'run',
      { companyId: claimed.companyId, closingId: claimed.aggregateId },
      expect.objectContaining({
        jobId: claimed.id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: 100,
      }),
    );
  });

  it('fails a mismatched aggregate without retry or enqueue', async () => {
    const { processor, fail, queue } = start();
    const claimed = event({ payload: { closing_id: ids.newId() } });
    expect(await processor.deliver(claimed)).toEqual({
      delivered: false,
      error: 'SERVICE_CATEGORY_CLOSING_EVENT_INVALID',
      retryInMs: null,
    });
    expect(fail).toHaveBeenCalledWith(
      claimed.companyId,
      claimed.aggregateId,
      'SERVICE_CATEGORY_CLOSING_FAILED',
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('retries when the failure of a mismatched aggregate cannot be persisted', async () => {
    const fail = vi.fn(async () => {
      throw new Error('private outage');
    });
    const { processor, queue } = start({ fail });
    expect(await processor.deliver(event({ payload: { closing_id: ids.newId() } }))).toEqual({
      delivered: false,
      error: 'SERVICE_CATEGORY_CLOSING_FAILURE_PERSIST_RETRY',
      retryInMs: 2000,
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('returns QUEUE_RETRY when the queue refuses the job', async () => {
    const { processor, queue } = start();
    queue.add.mockRejectedValueOnce(new Error('private queue outage'));
    expect(await processor.deliver(event())).toEqual({
      delivered: false,
      error: 'SERVICE_CATEGORY_CLOSING_QUEUE_RETRY',
      retryInMs: 2000,
    });
  });
});

interface TestJob {
  data: { companyId: string; closingId: string };
  progress: unknown;
  attemptsStarted: number;
  attemptsMade: number;
  stalledCounter: number;
  opts: { attempts: number };
  /** BullMQ بيكتبه بس لما المهمة تتقفل نهائيًا؛ الفشل اللي فيه محاولات باقية بيفضل فاضي. */
  finishedOn: number | undefined;
  failedReason: string | undefined;
  updateProgress: ReturnType<typeof vi.fn>;
  moveToDelayed: ReturnType<typeof vi.fn>;
}

function job(): TestJob {
  const value: TestJob = {
    data: { companyId: ids.newId(), closingId: ids.newId() },
    progress: undefined,
    attemptsStarted: 3,
    attemptsMade: 2,
    stalledCounter: 0,
    opts: { attempts: 3 },
    finishedOn: undefined,
    failedReason: undefined,
    updateProgress: vi.fn(async (progress: unknown) => {
      value.progress = progress;
    }),
    moveToDelayed: vi.fn(async () => undefined),
  };
  return value;
}

function failedListener(): (job: never) => void {
  const listener = state.failed[0];
  if (listener === undefined) throw new Error('EXPECTED_CLOSING_PROCESSOR_FAILED_LISTENER');
  return listener;
}

describe('job handler', () => {
  it('runs the job on the first attempt', async () => {
    const execute = vi.fn(async () => undefined);
    start({ execute });
    const value = job();
    await first(state.workers).handler(value as never, 'token');
    expect(execute).toHaveBeenCalledWith(value.data.companyId, value.data.closingId);
    expect(value.progress).toBeUndefined();
  });

  it('rethrows a failure before the last attempt so the queue retries it', async () => {
    const execute = vi.fn(async () => {
      throw new Error('private processing failure');
    });
    start({ execute });
    const value = job();
    value.attemptsMade = 0;
    value.attemptsStarted = 1;
    await expect(first(state.workers).handler(value as never, 'token')).rejects.toThrow(
      'private processing failure',
    );
    expect(value.progress).toBeUndefined();
  });
});

describe('finalization', () => {
  it('persists the generic failure on the last attempt', async () => {
    const execute = vi.fn(async () => {
      throw new Error('private processing failure');
    });
    const { fail } = start({ execute });
    const value = job();
    await first(state.workers).handler(value as never, 'token');
    expect(value.progress).toEqual({
      stage: 'finalizing-service-category-closing-failure',
      code: 'SERVICE_CATEGORY_CLOSING_FAILED',
    });
    expect(fail).toHaveBeenCalledWith(
      value.data.companyId,
      value.data.closingId,
      'SERVICE_CATEGORY_CLOSING_FAILED',
    );
  });

  it('delays a failing finalization and throws DelayedError', async () => {
    const execute = vi.fn(async () => {
      throw new Error('private processing failure');
    });
    const fail = vi.fn(async () => {
      throw new Error('private persistence failure');
    });
    start({ execute, fail });
    const value = job();
    await expect(first(state.workers).handler(value as never, 'token')).rejects.toBeInstanceOf(
      DelayedError,
    );
    expect(value.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'token');
  });

  it('persists the generic failure even when the progress marker is rejected', async () => {
    const execute = vi.fn(async () => {
      throw new Error('private processing failure');
    });
    const { fail } = start({ execute });
    const value = job();
    value.updateProgress.mockImplementation(async () => {
      throw new Error('private progress outage');
    });
    await first(state.workers).handler(value as never, 'token');
    expect(fail).toHaveBeenCalledWith(
      value.data.companyId,
      value.data.closingId,
      'SERVICE_CATEGORY_CLOSING_FAILED',
    );
  });
});

describe('delayed finalization', () => {
  it('retries only the failure write when the delayed finalization reactivates the job', async () => {
    const execute = vi.fn(async () => {
      throw new Error('private processing failure');
    });
    const fail = vi
      .fn()
      .mockRejectedValueOnce(new Error('private persistence failure'))
      .mockResolvedValueOnce(undefined);
    start({ execute, fail });
    const value = job();
    value.updateProgress.mockImplementation(async () => {
      throw new Error('private progress outage');
    });
    await expect(first(state.workers).handler(value as never, 'token')).rejects.toBeInstanceOf(
      DelayedError,
    );

    value.attemptsStarted += 1;
    await expect(first(state.workers).handler(value as never, 'token')).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(value.updateProgress).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenLastCalledWith(
      value.data.companyId,
      value.data.closingId,
      'SERVICE_CATEGORY_CLOSING_FAILED',
    );
  });
});

describe('terminal job failure', () => {
  it('writes the failure when the stalled limit closes a job that still has attempts', () => {
    const { fail } = start();
    const value = job();
    value.attemptsMade = 1;
    value.stalledCounter = 2;
    value.finishedOn = 1_700_000_000_000;
    value.failedReason = 'job stalled more than allowable limit';
    failedListener()(value as never);
    expect(fail).toHaveBeenCalledWith(
      value.data.companyId,
      value.data.closingId,
      'SERVICE_CATEGORY_CLOSING_FAILED',
    );
  });

  it('leaves the request row alone when the failure still has attempts left', () => {
    const { fail } = start();
    const value = job();
    value.attemptsMade = 1;
    value.stalledCounter = 0;
    value.finishedOn = undefined;
    value.failedReason = 'private processing failure';
    failedListener()(value as never);
    expect(fail).not.toHaveBeenCalled();
  });

  it('swallows a rejected failure write instead of throwing into the queue', async () => {
    const fail = vi.fn(async () => {
      throw new Error('private persistence failure');
    });
    start({ fail });
    const value = job();
    value.finishedOn = 1_700_000_000_000;
    expect(() => failedListener()(value as never)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fail).toHaveBeenCalledTimes(1);
  });
});
