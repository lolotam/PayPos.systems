import { expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import { systemUuidV7 } from '@pospay/ids';
import type { ClaimedEvent } from '@pospay/db';
import {
  PACKAGE_PREVIEW_QUEUE,
  startPackagePreviewProcessor,
} from './package-preview.processor.ts';
import type { ExecutePackagePreview } from '../use-cases/execute-package-preview/execute-package-preview.ts';

it('transports only ids after outbox delivery, retries safely and marks exhausted jobs failed', async () => {
  const ids = systemUuidV7();
  const redisUrl =
    process.env['REDIS_URL'] ||
    `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;
  const prefix = `package-preview-test-${ids.newId()}`;
  const execute = vi.fn(async () => {
    throw new Error('Synthetic retry');
  });
  const fail = vi.fn(async () => undefined);
  const processor = startPackagePreviewProcessor(
    { execute, fail } as unknown as ExecutePackagePreview,
    redisUrl,
    prefix,
  );
  const queue = new Queue(PACKAGE_PREVIEW_QUEUE, { connection: { url: redisUrl }, prefix });
  const previewId = ids.newId();
  const event: ClaimedEvent = {
    companyId: ids.newId(),
    id: ids.newId(),
    aggregateId: previewId,
    aggregateType: 'import_preview',
    eventType: 'PackageImportPreviewRequested',
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
      error: 'PACKAGE_PREVIEW_QUEUE_RETRY',
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

it('keeps failure persistence durable across a database outage and processor restart without reparsing', async () => {
  const ids = systemUuidV7();
  const redisUrl =
    process.env['REDIS_URL'] ||
    `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;
  const prefix = `package-finalization-test-${ids.newId()}`;
  let available = false;
  let persisted = false;
  const execute = vi.fn(async () => {
    throw new Error('Synthetic processing failure');
  });
  const fail = vi.fn(async () => {
    if (!available) throw new Error('Synthetic database outage');
    persisted = true;
  });
  const useCase = { execute, fail } as unknown as ExecutePackagePreview;
  let processor = startPackagePreviewProcessor(useCase, redisUrl, prefix);
  const queue = new Queue(PACKAGE_PREVIEW_QUEUE, { connection: { url: redisUrl }, prefix });
  const event: ClaimedEvent = {
    id: ids.newId(),
    companyId: ids.newId(),
    aggregateType: 'import_preview',
    aggregateId: ids.newId(),
    eventType: 'PackageImportPreviewRequested',
    payload: { preview_id: ids.newId() },
    attempt: 1,
  };
  try {
    await processor.ready();
    expect(await processor.deliver(event)).toEqual({ delivered: true });
    await vi.waitFor(
      async () => {
        const job = await queue.getJob(event.id);
        expect(job?.progress).toBe('finalizing-preview-failure');
        expect(await job?.getState()).toBe('delayed');
        expect(job?.data).toEqual({
          companyId: event.companyId,
          previewId: (event.payload as { preview_id: string }).preview_id,
        });
      },
      { timeout: 15000 },
    );
    expect(persisted).toBe(false);
    expect(execute).toHaveBeenCalledTimes(3);
    await processor.close();
    available = true;
    processor = startPackagePreviewProcessor(useCase, redisUrl, prefix);
    await processor.ready();
    await vi.waitFor(() => expect(persisted).toBe(true), { timeout: 10000 });
    expect(execute).toHaveBeenCalledTimes(3);
    expect(fail.mock.calls.length).toBeGreaterThanOrEqual(2);
  } finally {
    await processor.close();
    await queue.obliterate({ force: true });
    await queue.close();
  }
}, 30000);
