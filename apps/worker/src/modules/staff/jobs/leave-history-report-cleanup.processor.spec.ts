import { beforeEach, expect, it, vi } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { LEAVE_HISTORY_REPORT_CLEANUP_EVERY_MS } from '@pospay/contracts';
import type { ClaimedEvent } from '@pospay/db';
import {
  LEAVE_HISTORY_REPORT_CLEANUP_QUEUE,
  startLeaveHistoryReportCleanupProcessor,
} from './leave-history-report-cleanup.processor.ts';
import type { CleanLeaveHistoryReports } from '../use-cases/clean-leave-history-reports/clean-leave-history-reports.ts';

const state = vi.hoisted(() => ({
  queues: [] as { upsertJobScheduler: ReturnType<typeof vi.fn> }[],
}));

vi.mock('bullmq', () => ({
  Queue: class {
    upsertJobScheduler = vi.fn();
    on = vi.fn();
    close = vi.fn(async () => undefined);
    constructor() {
      state.queues.push(this);
    }
  },
  Worker: class {
    on = vi.fn();
    close = vi.fn(async () => undefined);
    waitUntilReady = vi.fn(async () => undefined);
  },
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

beforeEach(() => {
  state.queues.length = 0;
});

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error('EXPECTED_CLEANUP_QUEUE');
  return value;
}

function setup() {
  const processor = startLeaveHistoryReportCleanupProcessor(
    { execute: vi.fn() } as unknown as CleanLeaveHistoryReports,
    'synthetic',
  );
  const queue = first(state.queues);
  const companyId = systemUuidV7().newId();
  const event: ClaimedEvent = {
    id: systemUuidV7().newId(),
    companyId,
    aggregateId: systemUuidV7().newId(),
    aggregateType: 'leave_history_report',
    eventType: 'LeaveHistoryReportRequested',
    payload: { report_id: systemUuidV7().newId() },
    attempt: 1,
  };
  return { processor, queue, event };
}

it('registers the company scheduler before acknowledging the report event', async () => {
  const { processor, queue, event } = setup();
  const calls: string[] = [];
  queue.upsertJobScheduler.mockImplementation(async () => {
    calls.push('schedule');
  });
  const next = vi.fn(async () => {
    calls.push('next');
    return { delivered: true as const };
  });
  expect(await processor.deliver(event, next)).toEqual({ delivered: true });
  expect(calls).toEqual(['schedule', 'next']);
  expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
    `${LEAVE_HISTORY_REPORT_CLEANUP_QUEUE}-${event.companyId}`,
    { every: LEAVE_HISTORY_REPORT_CLEANUP_EVERY_MS },
    expect.objectContaining({ name: 'clean', data: { companyId: event.companyId } }),
  );
});

it('returns SCHEDULE_RETRY and does not acknowledge when scheduling fails', async () => {
  const { processor, queue, event } = setup();
  queue.upsertJobScheduler.mockRejectedValueOnce(new Error('private scheduler outage'));
  const next = vi.fn(async () => ({ delivered: true as const }));
  expect(await processor.deliver(event, next)).toEqual({
    delivered: false,
    error: 'LEAVE_HISTORY_REPORT_CLEANUP_SCHEDULE_RETRY',
    retryInMs: 2000,
  });
  expect(next).not.toHaveBeenCalled();
});
