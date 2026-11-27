import { beforeEach, describe, expect, it, vi } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { FailurePersistedError } from './catalog-job-finalization.ts';
import {
  SERVICE_CATEGORY_CLOSING_FINALIZATION_QUEUE,
  SERVICE_CATEGORY_CLOSING_QUEUE,
  startServiceCategoryClosingProcessor,
  terminalFailureJobId,
} from './service-category-closing.processor.ts';
import type { RunServiceCategoryClosing } from '../use-cases/run-service-category-closing/run-service-category-closing.ts';

// #1047 و#1048: طابور إعادة المحاولة المنفصل يحمي العمالة القديمة، والمعرّف خالٍ من (:)،
// والإغلاق يستنزف الكتابات المعلّقة ويقفل الطوابير حتى لو رفض worker.close().

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
    onFailed?: (job: never, error?: Error) => void;
  }[],
}));

vi.mock('bullmq', () => ({
  Queue: class {
    add = vi.fn(async (_name: string, _data: unknown, opts?: { jobId?: string }) => {
      // نفس قاعدة BullMQ 6.2.0: أي jobId فيه (:) لا يُقبل إلا لو اتقسم 3 أجزاء بالضبط.
      if (opts?.jobId?.includes(':') && opts.jobId.split(':').length !== 3) {
        throw new Error('Custom Id cannot contain :');
      }
      return undefined;
    });
    close = vi.fn(async () => undefined);
    on = vi.fn();
    constructor(readonly name: string) {
      state.queues.push(this);
    }
  },
  Worker: class {
    onFailed?: (job: never, error?: Error) => void;
    waitUntilReady = vi.fn(async () => undefined);
    close = vi.fn(async () => undefined);
    on = vi.fn((event: string, listener: (job: never, error?: Error) => void) => {
      if (event === 'failed') this.onFailed = listener;
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

function job(name = 'run', id: string | undefined = ids.newId()): TestJob {
  return {
    name,
    id,
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

function named<T extends { name: string }>(values: readonly T[], name: string): T {
  const found = values.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`EXPECTED_CLOSING_DOUBLE:${name}`);
  return found;
}

function start(
  overrides: {
    execute?: ReturnType<typeof vi.fn>;
    fail?: ReturnType<typeof vi.fn>;
    onDrop?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const execute = overrides.execute ?? vi.fn(async () => undefined);
  const fail = overrides.fail ?? vi.fn(async () => undefined);
  const processor = startServiceCategoryClosingProcessor(
    { execute, fail } as unknown as RunServiceCategoryClosing,
    'synthetic',
    'bull',
    overrides.onDrop as never,
  );
  return {
    processor,
    execute,
    fail,
    closingQueue: named(state.queues, SERVICE_CATEGORY_CLOSING_QUEUE),
    finalizationQueue: named(state.queues, SERVICE_CATEGORY_CLOSING_FINALIZATION_QUEUE),
    closingWorker: named(state.workers, SERVICE_CATEGORY_CLOSING_QUEUE),
    finalizationWorker: named(state.workers, SERVICE_CATEGORY_CLOSING_FINALIZATION_QUEUE),
  };
}

it('terminal failure retry (#1047): enqueues a colon-free jobId on the dedicated finalization queue when the terminal write fails', async () => {
  const fail = vi.fn(async () => {
    throw new Error('private persistence failure');
  });
  const { closingQueue, finalizationQueue, closingWorker, finalizationWorker } = start({ fail });
  const terminal = job('run', 'bull:parent:1:2');
  terminal.finishedOn = 1_700_000_000_000;

  closingWorker.onFailed?.(terminal as never);

  await vi.waitFor(() => expect(finalizationQueue.add).toHaveBeenCalledTimes(1));
  expect(closingQueue.add).not.toHaveBeenCalled();
  expect(finalizationWorker.onFailed).toBeUndefined();
  const expectedJobId = terminalFailureJobId(terminal.data.closingId, terminal.id);
  expect(expectedJobId).not.toContain(':');
  expect(finalizationQueue.add).toHaveBeenCalledWith('finalizing-failure', terminal.data, {
    jobId: expectedJobId,
    delay: 2000,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: true,
    removeOnFail: 100,
  });
});

it('terminal failure retry (#1047): writes the failure mark on the dedicated finalization worker without running execute and lets BullMQ count retries', async () => {
  const fail = vi
    .fn()
    .mockRejectedValueOnce(new Error('private persistence failure'))
    .mockResolvedValueOnce(undefined);
  const { finalizationWorker, execute } = start({ fail });
  const retry = job('finalizing-failure');
  retry.data = { companyId: ids.newId(), closingId: ids.newId() };

  await expect(finalizationWorker.handler(retry as never, 'token')).rejects.toThrow(
    'SERVICE_CATEGORY_CLOSING_FINALIZATION_RETRY',
  );
  await expect(finalizationWorker.handler(retry as never, 'token')).resolves.toBeUndefined();
  expect(fail).toHaveBeenCalledTimes(2);
  expect(fail).toHaveBeenLastCalledWith(
    retry.data.companyId,
    retry.data.closingId,
    'SERVICE_CATEGORY_CLOSING_FAILED',
  );
  expect(execute).not.toHaveBeenCalled();
});

it('terminal failure retry (#1047): falls back to a direct fail write and notifies the observer if both fail() and enqueue reject', async () => {
  const fail = vi.fn(async () => {
    throw new Error('private persistence failure');
  });
  const onDrop = vi.fn();
  const { closingWorker, finalizationQueue } = start({ fail, onDrop });
  finalizationQueue.add.mockRejectedValueOnce(new Error('private redis outage'));
  const terminal = job();
  terminal.finishedOn = 1_700_000_000_000;

  closingWorker.onFailed?.(terminal as never);

  await vi.waitFor(() => expect(onDrop).toHaveBeenCalledTimes(1));
  expect(fail).toHaveBeenCalledTimes(2);
  expect(onDrop).toHaveBeenCalledWith({
    companyId: terminal.data.companyId,
    closingId: terminal.data.closingId,
    code: 'SERVICE_CATEGORY_CLOSING_FAILURE_RETRY_DROPPED',
  });
});

it('terminal failure retry (#1047): swallows a throwing drop observer without unhandled rejections', async () => {
  const fail = vi.fn(async () => {
    throw new Error('private persistence failure');
  });
  const onDrop = vi.fn(() => {
    throw new Error('observer crashed');
  });
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    const { processor, closingWorker, finalizationQueue } = start({ fail, onDrop });
    finalizationQueue.add.mockRejectedValueOnce(new Error('private redis outage'));
    const terminal = job();
    terminal.finishedOn = 1_700_000_000_000;

    closingWorker.onFailed?.(terminal as never);

    await vi.waitFor(() => expect(onDrop).toHaveBeenCalledTimes(1));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(unhandled).toEqual([]);
    await processor.close();
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

describe('graceful shutdown (#1048)', () => {
  it('waits for the in-flight failure write before closing both queues', async () => {
    let release: (() => void) | undefined;
    const written = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fail = vi.fn(async () => written);
    const { processor, closingQueue, finalizationQueue, closingWorker } = start({ fail });
    const terminal = job();
    terminal.finishedOn = 1_700_000_000_000;
    closingWorker.onFailed?.(terminal as never);
    await vi.waitFor(() => expect(fail).toHaveBeenCalledTimes(1));

    let closed = false;
    const closing = processor.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).toBe(false);
    expect(closingQueue.close).not.toHaveBeenCalled();
    expect(finalizationQueue.close).not.toHaveBeenCalled();

    release?.();
    await closing;
    expect(closed).toBe(true);
    expect(closingQueue.close).toHaveBeenCalledTimes(1);
    expect(finalizationQueue.close).toHaveBeenCalledTimes(1);
  });

  it('still drains in-flight failure writes and closes both queues when worker.close() rejects', async () => {
    let release: (() => void) | undefined;
    const written = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fail = vi.fn(async () => written);
    const { processor, closingQueue, finalizationQueue, closingWorker, finalizationWorker } = start(
      {
        fail,
      },
    );
    const closeError = new Error('synthetic worker close failure');
    closingWorker.close.mockRejectedValueOnce(closeError);
    const terminal = job();
    terminal.finishedOn = 1_700_000_000_000;
    closingWorker.onFailed?.(terminal as never);
    await vi.waitFor(() => expect(fail).toHaveBeenCalledTimes(1));

    let settled = false;
    const closing = processor.close().catch((error: unknown) => {
      settled = true;
      return error;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    expect(finalizationWorker.close).toHaveBeenCalledTimes(1);
    expect(closingQueue.close).not.toHaveBeenCalled();

    release?.();
    expect(await closing).toBe(closeError);
    expect(closingQueue.close).toHaveBeenCalledTimes(1);
    expect(finalizationQueue.close).toHaveBeenCalledTimes(1);
  });
});

it('does not count FailurePersistedError as an unexpected failed write in finalization spec', () => {
  expect(new FailurePersistedError('x').name).toBe('UnrecoverableError');
});
