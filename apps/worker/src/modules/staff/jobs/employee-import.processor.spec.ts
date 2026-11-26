import { expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import { systemUuidV7 } from '@pospay/ids';
import type { ClaimedEvent } from '@pospay/db';
import {
  EMPLOYEE_IMPORT_QUEUE,
  startEmployeeImportProcessor,
} from './employee-import.processor.ts';
import type { CommitEmployeeImport } from '../use-cases/commit-employee-import/commit-employee-import.ts';

it('transports only ids after outbox delivery, retries safely and marks exhausted jobs failed', async () => {
  const ids = systemUuidV7();
  const redisUrl =
    process.env['REDIS_URL'] ||
    `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;
  const prefix = `employee-import-test-${ids.newId()}`;
  const execute = vi.fn(async () => {
    throw new Error('Synthetic retry');
  });
  const fail = vi.fn(async () => undefined);
  const processor = startEmployeeImportProcessor(
    { execute, fail } as unknown as CommitEmployeeImport,
    redisUrl,
    prefix,
  );
  const queue = new Queue(EMPLOYEE_IMPORT_QUEUE, { connection: { url: redisUrl }, prefix });
  const previewId = ids.newId();
  const event: ClaimedEvent = {
    companyId: ids.newId(),
    id: ids.newId(),
    aggregateId: previewId,
    aggregateType: 'import_preview',
    eventType: 'EmployeeImportCommitRequested',
    payload: { preview_id: previewId },
    attempt: 1,
  };
  try {
    await processor.ready();
    expect(await processor.deliver(event)).toEqual({ delivered: true });
    expect(await processor.deliver(event)).toEqual({ delivered: true });
    const job = await queue.getJob(event.id);
    expect(job?.data).toEqual({ companyId: event.companyId, previewId });
    await vi.waitFor(() => expect(fail).toHaveBeenCalledWith(event.companyId, previewId), {
      timeout: 15000,
    });
    expect(execute).toHaveBeenCalledTimes(3);
    const reject = vi
      .spyOn(Queue.prototype, 'add')
      .mockRejectedValueOnce(new Error('Synthetic unavailable'));
    expect(await processor.deliver(event)).toEqual({
      delivered: false,
      error: 'EMPLOYEE_IMPORT_QUEUE_RETRY',
      retryInMs: 2000,
    });
    reject.mockRestore();
  } finally {
    await processor.close();
    await queue.obliterate({ force: true });
    await queue.close();
    vi.restoreAllMocks();
  }
}, 25000);

it('uses the injected retryDelayMs policy when enqueue fails', async () => {
  const ids = systemUuidV7();
  const redisUrl =
    process.env['REDIS_URL'] ||
    `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;
  const prefix = `employee-import-policy-${ids.newId()}`;
  const retryDelayMs = vi.fn((attempt: number) => (attempt >= 10 ? null : 5000));
  const processor = startEmployeeImportProcessor(
    {
      execute: async () => undefined,
      fail: async () => undefined,
    } as unknown as CommitEmployeeImport,
    redisUrl,
    prefix,
    retryDelayMs,
  );
  const queue = new Queue(EMPLOYEE_IMPORT_QUEUE, { connection: { url: redisUrl }, prefix });
  const makeEvent = (attempt: number): ClaimedEvent => {
    const previewId = ids.newId();
    return {
      companyId: ids.newId(),
      id: ids.newId(),
      aggregateId: previewId,
      aggregateType: 'import_preview',
      eventType: 'EmployeeImportCommitRequested',
      payload: { preview_id: previewId },
      attempt,
    };
  };
  try {
    await processor.ready();
    const reject = vi
      .spyOn(Queue.prototype, 'add')
      .mockRejectedValue(new Error('Synthetic unavailable'));
    expect(await processor.deliver(makeEvent(1))).toEqual({
      delivered: false,
      error: 'EMPLOYEE_IMPORT_QUEUE_RETRY',
      retryInMs: 5000,
    });
    expect(await processor.deliver(makeEvent(10))).toEqual({
      delivered: false,
      error: 'EMPLOYEE_IMPORT_QUEUE_RETRY',
      retryInMs: null,
    });
    expect(retryDelayMs.mock.calls).toEqual([[1], [10]]);
    reject.mockRestore();
  } finally {
    await processor.close();
    await queue.obliterate({ force: true });
    await queue.close();
    vi.restoreAllMocks();
  }
});
