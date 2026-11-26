import { DelayedError, UnrecoverableError } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { FailurePersistedError } from './catalog-job-finalization.ts';
import { startServiceImportProcessor } from './service-import-commit.processor.ts';
import type { CommitServiceImport } from '../use-cases/commit-service-import/commit-service-import.ts';

// FR-009 (#1197): الإنهاء بعد آخر محاولة لا يعيد تشغيل الاستيراد ولو ضاع مؤشر التقدم، وينتهي الصف في «الفاشل».

const state = vi.hoisted(() => ({
  workers: [] as { handler: (job: never, token?: string) => Promise<unknown> }[],
  failed: [] as ((job: never, error?: Error) => void)[],
}));

vi.mock('bullmq', () => ({
  Queue: class {
    add = vi.fn();
    close = vi.fn(async () => undefined);
    on = vi.fn();
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
  state.workers.length = 0;
  state.failed.length = 0;
});

interface TestJob {
  data: { companyId: string; previewId: string };
  progress: unknown;
  attemptsStarted: number;
  attemptsMade: number;
  stalledCounter: number;
  opts: { attempts: number };
  finishedOn: number | undefined;
  updateProgress: ReturnType<typeof vi.fn>;
  moveToDelayed: ReturnType<typeof vi.fn>;
}

/** المحاولة الرابعة الأخيرة: ثلاث محاولات فاشلة سابقة وتفعيل واحد جارٍ. */
function lastAttemptJob(): TestJob {
  const value: TestJob = {
    data: { companyId: ids.newId(), previewId: ids.newId() },
    progress: 0,
    attemptsStarted: 4,
    attemptsMade: 3,
    stalledCounter: 0,
    opts: { attempts: 4 },
    finishedOn: undefined,
    updateProgress: vi.fn(async (progress: unknown) => {
      value.progress = progress;
    }),
    moveToDelayed: vi.fn(async () => undefined),
  };
  return value;
}

function start(execute: ReturnType<typeof vi.fn>, fail: ReturnType<typeof vi.fn>) {
  startServiceImportProcessor({ execute, fail } as unknown as CommitServiceImport, 'synthetic');
  const worker = state.workers[0];
  const listener = state.failed[0];
  if (worker === undefined || listener === undefined) throw new Error('EXPECTED_IMPORT_DOUBLES');
  return { handler: worker.handler, failedListener: listener };
}

const failingExecute = () =>
  vi.fn(async () => {
    throw new Error('private processing failure');
  });

describe('final attempt', () => {
  it('rejects with FailurePersistedError once the failure write succeeds', async () => {
    const fail = vi.fn(async () => undefined);
    const { handler } = start(failingExecute(), fail);
    const value = lastAttemptJob();
    await expect(handler(value as never, 'token')).rejects.toBeInstanceOf(FailurePersistedError);
    expect(fail).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledWith(value.data.companyId, value.data.previewId);
  });

  it('does not write a second time when the failed listener sees that FailurePersistedError', async () => {
    const fail = vi.fn(async () => undefined);
    const { handler, failedListener } = start(failingExecute(), fail);
    const value = lastAttemptJob();
    const error = await handler(value as never, 'token').catch((caught: unknown) => caught);
    value.finishedOn = 1_700_000_000_000;
    failedListener(value as never, error as Error);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fail).toHaveBeenCalledTimes(1);
  });

  it('still writes the failure when BullMQ closes the job at the stall limit', async () => {
    const fail = vi.fn(async () => undefined);
    const { failedListener } = start(vi.fn(), fail);
    const value = lastAttemptJob();
    value.finishedOn = 1_700_000_000_000;
    failedListener(value as never, new UnrecoverableError('job stalled more than allowable limit'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fail).toHaveBeenCalledWith(value.data.companyId, value.data.previewId);
  });
});

describe('delayed finalization', () => {
  it('never re-executes after our own delay even when the progress marker was lost', async () => {
    const execute = failingExecute();
    const fail = vi
      .fn()
      .mockRejectedValueOnce(new Error('private persistence failure'))
      .mockResolvedValueOnce(undefined);
    const { handler } = start(execute, fail);
    const value = lastAttemptJob();
    value.updateProgress.mockImplementation(async () => {
      throw new Error('private progress outage');
    });

    await expect(handler(value as never, 'token')).rejects.toBeInstanceOf(DelayedError);
    expect(value.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'token');
    expect(execute).toHaveBeenCalledTimes(1);

    // DelayedError لا يزيد attemptsMade: التفعيل التالي يرفع attemptsStarted فقط والمؤشر غير مكتوب.
    value.attemptsStarted += 1;
    expect(value.progress).toBe(0);
    await expect(handler(value as never, 'token')).rejects.toBeInstanceOf(FailurePersistedError);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledTimes(2);
  });

  it('does not treat a stalled reactivation as our delay', async () => {
    const execute = vi.fn(async () => undefined);
    const { handler } = start(execute, vi.fn(async () => undefined));
    const value = lastAttemptJob();
    value.attemptsMade = 1;
    value.attemptsStarted = 3;
    value.stalledCounter = 1;
    await handler(value as never, 'token');
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
