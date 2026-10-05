import { expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import type { ClaimedEvent } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { startRetentionProcessors } from './retention.processor.ts';
import type { CleanupFiles } from '../use-cases/cleanup-files/cleanup-files.ts';

it('outbox delivery idempotently registers two id-only worker schedules and retries scheduling errors', async () => {
  const ids = systemUuidV7(),
    prefix = `files-retention-test-${ids.newId()}`;
  const redisUrl =
    process.env['REDIS_URL'] ||
    `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;
  const execute = vi.fn(async () => 0);
  const processor = startRetentionProcessors(
    { execute } as unknown as CleanupFiles,
    redisUrl,
    prefix,
  );
  const queues = ['abandoned', 'rejected'].map(
    (kind) => new Queue(`files-cleanup-${kind}`, { connection: { url: redisUrl }, prefix }),
  );
  const event: ClaimedEvent = {
    companyId: ids.newId(),
    id: ids.newId(),
    aggregateId: ids.newId(),
    aggregateType: 'file',
    eventType: 'FileUploadRequested',
    payload: {},
    attempt: 1,
  };
  try {
    await processor.ready();
    expect(await processor.deliver(event)).toEqual({ delivered: true });
    expect(await processor.deliver(event)).toEqual({ delivered: true });
    for (const queue of queues) {
      const schedules = await queue.getJobSchedulers();
      expect(schedules).toHaveLength(1);
      expect(schedules[0]?.template?.data).toEqual({ companyId: event.companyId });
      expect(schedules[0]?.every).toBe(3600000);
    }
    await vi.waitFor(
      () => {
        expect(execute).toHaveBeenCalledWith(event.companyId, 'abandoned');
        expect(execute).toHaveBeenCalledWith(event.companyId, 'rejected');
      },
      { timeout: 10000 },
    );
    const fail = vi
      .spyOn(Queue.prototype, 'upsertJobScheduler')
      .mockRejectedValueOnce(new Error('synthetic failure'));
    expect(await processor.deliver(event)).toEqual({
      delivered: false,
      error: 'FILE_RETENTION_SCHEDULE_RETRY',
      retryInMs: 2000,
    });
    fail.mockRestore();
    expect(await processor.deliver(event)).toEqual({ delivered: true });
  } finally {
    vi.restoreAllMocks();
    await processor.close();
    for (const queue of queues) {
      await queue.obliterate({ force: true });
      await queue.close();
    }
  }
});
