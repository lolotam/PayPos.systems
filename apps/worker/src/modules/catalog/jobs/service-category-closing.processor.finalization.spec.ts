import { beforeEach, describe, expect, it, vi } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { FailurePersistedError } from './catalog-job-finalization.ts';
import { startServiceCategoryClosingProcessor } from './service-category-closing.processor.ts';
import type { RunServiceCategoryClosing } from '../use-cases/run-service-category-closing/run-service-category-closing.ts';

// #1047 و#1048: رفض القاعدة لكتابة رمز الفشل كان بيضيع العلامة وبيسيب صف
// الطلب معلّق للأبد، والإغلاق كان بيقفل الطابور قبل ما الكتابة تخلص.

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
  failed: [] as ((job: never, error?: Error) => void)[],
}));

vi.mock('bullmq', () => ({
  Queue: class {
    add = vi.fn(async () => undefined);
    close = vi.fn(async () => undefined);
    on = vi.fn();
    constructor(readonly name: string) {
      state.queues.push(this);
    }
  },
  Worker: class {
    waitUntilReady = vi.fn(async () => undefined);
    close = vi.fn(async () => undefined);
    on = vi.fn((event: string, listener: (job: never, error?: Error) => void) => {
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
  UnrecoverableError: class UnrecoverableError extends Error {},
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

interface TestJob {
  name: string;
  id: string | undefined;
  data: { companyId: string; closingId: string };
  progress: unknown;
  attemptsStarted: number;
  attemptsMade: number;
  stalledCounter: number;
  opts: { attempts: number };
  finishedOn: number | undefined;
  updateProgress: ReturnType<typeof vi.fn>;
  moveToDelayed: ReturnType<typeof vi.fn>;
}

function job(name = 'run'): TestJob {
  return {
    name,
    id: ids.newId(),
    data: { companyId: ids.newId(), closingId: ids.newId() },
    progress: undefined,
    attemptsStarted: 1,
    attemptsMade: 1,
    stalledCounter: 0,
    opts: { attempts: 3 },
    finishedOn: undefined,
    updateProgress: vi.fn(async () => undefined),
    moveToDelayed: vi.fn(async () => undefined),
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
  return { processor, execute, fail, queue: first(state.queues), worker: first(state.workers) };
}

function failedListener(): (job: never, error?: Error) => void {
  const listener = state.failed[0];
  if (listener === undefined) throw new Error('EXPECTED_CLOSING_PROCESSOR_FAILED_LISTENER');
  return listener;
}

describe('terminal failure retry (#1047)', () => {
  it('queues a delayed finalization job when the failure mark cannot be written', async () => {
    const fail = vi.fn(async () => {
      throw new Error('private persistence failure');
    });
    const { queue } = start({ fail });
    const terminal = job();
    terminal.finishedOn = 1_700_000_000_000;

    failedListener()(terminal as never);

    await vi.waitFor(() => expect(queue.add).toHaveBeenCalledTimes(1));
    expect(queue.add).toHaveBeenCalledWith('finalizing-failure', terminal.data, {
      jobId: `${terminal.data.closingId}:terminal-fail:${terminal.id ?? 'job'}`,
      delay: 2000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
  });

  it('writes the failure mark on the retry job without running the closing again', async () => {
    const fail = vi
      .fn()
      .mockRejectedValueOnce(new Error('private persistence failure'))
      .mockResolvedValueOnce(undefined);
    const { worker, execute } = start({ fail });
    const terminal = job();
    terminal.finishedOn = 1_700_000_000_000;
    failedListener()(terminal as never);
    await vi.waitFor(() => expect(fail).toHaveBeenCalledTimes(1));

    const retry = job('finalizing-failure');
    retry.data = terminal.data;
    await expect(worker.handler(retry as never, 'token')).rejects.toBeInstanceOf(
      FailurePersistedError,
    );
    expect(fail).toHaveBeenCalledTimes(2);
    expect(fail).toHaveBeenLastCalledWith(
      terminal.data.companyId,
      terminal.data.closingId,
      'SERVICE_CATEGORY_CLOSING_FAILED',
    );
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('graceful shutdown (#1048)', () => {
  it('waits for the in-flight failure write before closing the queue', async () => {
    let release: (() => void) | undefined;
    const written = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fail = vi.fn(async () => written);
    const { processor, queue } = start({ fail });
    const terminal = job();
    terminal.finishedOn = 1_700_000_000_000;
    failedListener()(terminal as never);
    await vi.waitFor(() => expect(fail).toHaveBeenCalledTimes(1));

    let closed = false;
    const closing = processor.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).toBe(false);
    expect(queue.close).not.toHaveBeenCalled();

    release?.();
    await closing;
    expect(closed).toBe(true);
    expect(queue.close).toHaveBeenCalledTimes(1);
  });
});
