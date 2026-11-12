import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import type { ClaimedEvent, Database } from '@pospay/db';
import { startStaffWorker } from '../staff.module.ts';

const state = vi.hoisted(() => ({
  queues: [] as {
    name: string;
    add: ReturnType<typeof vi.fn>;
    upsertJobScheduler: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }[],
  workers: [] as {
    name: string;
    waitUntilReady: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }[],
}));

vi.mock('bullmq', () => ({
  Queue: class {
    add = vi.fn();
    upsertJobScheduler = vi.fn();
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
    constructor(readonly name: string) {
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
let staff: ReturnType<typeof startStaffWorker>;

beforeEach(() => {
  state.queues.length = 0;
  state.workers.length = 0;
  staff = startStaffWorker(
    { withTenant: vi.fn() } as unknown as Pick<Database, 'withTenant'>,
    ids,
    'synthetic',
    { now: () => new Date('2026-11-07T10:00:00.000Z') },
  );
});

afterEach(async () => {
  await staff.close();
});

it('constructs build and cleanup workers and knows the requested event', () => {
  expect(state.workers.map((worker) => worker.name)).toEqual(
    expect.arrayContaining(['leave-history-report', 'leave-history-report-cleanup']),
  );
  expect(staff.eventTypes).toContain('LeaveHistoryReportRequested');
});

it.each(['leave-history-report', 'leave-history-report-cleanup'])(
  'reportsReady rejects when %s is not ready',
  async (queueName) => {
    state.workers
      .find((worker) => worker.name === queueName)
      ?.waitUntilReady.mockRejectedValueOnce(new Error('synthetic not ready'));
    await expect(staff.reportsReady()).rejects.toThrow('synthetic not ready');
  },
);

it('schedules cleanup before enqueueing a report and does not call next', async () => {
  const reportId = ids.newId();
  const event: ClaimedEvent = {
    id: ids.newId(),
    companyId: ids.newId(),
    aggregateId: reportId,
    aggregateType: 'leave_history_report',
    eventType: 'LeaveHistoryReportRequested',
    payload: { report_id: reportId },
    attempt: 1,
  };
  const calls: string[] = [];
  state.queues
    .find((queue) => queue.name === 'leave-history-report-cleanup')
    ?.upsertJobScheduler.mockImplementation(async () => {
      calls.push('cleanup');
    });
  const reports = state.queues.find((queue) => queue.name === 'leave-history-report');
  reports?.add.mockImplementation(async () => {
    calls.push('report');
  });
  const next = vi.fn(async () => ({ delivered: true as const }));
  expect(await staff.deliver(event, next)).toEqual({ delivered: true });
  expect(calls).toEqual(['cleanup', 'report']);
  expect(reports?.add).toHaveBeenCalledWith(
    'build',
    { companyId: event.companyId, reportId },
    expect.objectContaining({ jobId: event.id }),
  );
  expect(next).not.toHaveBeenCalled();
});

it('keeps the existing employee-import delivery branch', async () => {
  const previewId = ids.newId();
  const event: ClaimedEvent = {
    id: ids.newId(),
    companyId: ids.newId(),
    aggregateId: previewId,
    aggregateType: 'import_preview',
    eventType: 'EmployeeImportCommitRequested',
    payload: { preview_id: previewId },
    attempt: 1,
  };
  const next = vi.fn(async () => ({ delivered: true as const }));
  expect(await staff.deliver(event, next)).toEqual({ delivered: true });
  expect(
    state.queues.find((queue) => queue.name === 'employee-import-recovery')?.upsertJobScheduler,
  ).toHaveBeenCalledOnce();
  expect(state.queues.find((queue) => queue.name === 'employee-import-commit')?.add).toHaveBeenCalledWith(
    'commit',
    { companyId: event.companyId, previewId },
    expect.objectContaining({ jobId: event.id }),
  );
  expect(next).not.toHaveBeenCalled();
});
