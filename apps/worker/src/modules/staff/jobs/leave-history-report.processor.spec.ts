import { DelayedError } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import type { ClaimedEvent } from '@pospay/db';
import { startLeaveHistoryReportProcessor } from './leave-history-report.processor.ts';
import {
  LeaveHistoryReportRetryError,
  type BuildLeaveHistoryReport,
} from '../use-cases/build-leave-history-report/build-leave-history-report.ts';

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
    on = vi.fn();
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
});

function event(overrides: Partial<ClaimedEvent> = {}): ClaimedEvent {
  const reportId = ids.newId();
  return {
    id: ids.newId(),
    companyId: ids.newId(),
    aggregateId: reportId,
    aggregateType: 'leave_history_report',
    eventType: 'LeaveHistoryReportRequested',
    payload: { report_id: reportId },
    attempt: 1,
    ...overrides,
  };
}

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error('EXPECTED_REPORT_PROCESSOR_DOUBLE');
  return value;
}

function start(overrides: { execute?: ReturnType<typeof vi.fn>; fail?: ReturnType<typeof vi.fn> } = {}) {
  const execute = overrides.execute ?? vi.fn(async () => undefined);
  const fail = overrides.fail ?? vi.fn(async () => undefined);
  const processor = startLeaveHistoryReportProcessor(
    { execute, fail } as unknown as BuildLeaveHistoryReport,
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
      'build',
      { companyId: claimed.companyId, reportId: claimed.aggregateId },
      expect.objectContaining({ jobId: claimed.id, attempts: 3, removeOnComplete: true }),
    );
  });

  it('fails a mismatched aggregate without retry or enqueue', async () => {
    const { processor, fail, queue } = start();
    const claimed = event({ payload: { report_id: ids.newId() } });
    expect(await processor.deliver(claimed)).toEqual({
      delivered: false,
      error: 'LEAVE_HISTORY_REPORT_EVENT_INVALID',
      retryInMs: null,
    });
    expect(fail).toHaveBeenCalledWith(claimed.companyId, claimed.aggregateId);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('retries when mismatch failure persistence fails', async () => {
    const fail = vi.fn(async () => {
      throw new Error('private outage');
    });
    const { processor, queue } = start({ fail });
    expect(await processor.deliver(event({ payload: { report_id: ids.newId() } }))).toEqual({
      delivered: false,
      error: 'LEAVE_HISTORY_REPORT_FAILURE_PERSIST_RETRY',
      retryInMs: 2000,
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('returns QUEUE_RETRY when queue.add fails', async () => {
    const { processor, queue } = start();
    queue.add.mockRejectedValueOnce(new Error('private queue outage'));
    expect(await processor.deliver(event())).toEqual({
      delivered: false,
      error: 'LEAVE_HISTORY_REPORT_QUEUE_RETRY',
      retryInMs: 2000,
    });
  });
});

describe('job handler', () => {
  interface TestJob {
    data: { companyId: string; reportId: string };
    progress: unknown;
    attemptsMade: number;
    opts: { attempts: number };
    updateProgress: ReturnType<typeof vi.fn>;
    moveToDelayed: ReturnType<typeof vi.fn>;
  }

  function job(): TestJob {
    const value: TestJob = {
      data: { companyId: ids.newId(), reportId: ids.newId() },
      progress: undefined,
      attemptsMade: 2,
      opts: { attempts: 3 },
      updateProgress: vi.fn(async (progress: unknown) => {
        value.progress = progress;
      }),
      moveToDelayed: vi.fn(async () => undefined),
    };
    return value;
  }

  it('saves failure progress on the last attempt and finalizes it', async () => {
    const execute = vi.fn(async () => {
      throw new LeaveHistoryReportRetryError('LEAVE_HISTORY_REPORT_TOO_LARGE');
    });
    const { processor, fail } = start({ execute });
    const value = job();
    await first(state.workers).handler(value as never, 'token');
    expect(value.progress).toEqual({
      stage: 'finalizing-leave-history-failure',
      code: 'LEAVE_HISTORY_REPORT_TOO_LARGE',
    });
    expect(fail).toHaveBeenCalledWith(
      value.data.companyId,
      value.data.reportId,
      'LEAVE_HISTORY_REPORT_TOO_LARGE',
    );
    expect(value.moveToDelayed).not.toHaveBeenCalled();
    await processor.close();
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
    expect(value.progress).toEqual({
      stage: 'finalizing-leave-history-failure',
      code: 'LEAVE_HISTORY_REPORT_FAILED',
    });
    expect(value.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'token');
  });
});
