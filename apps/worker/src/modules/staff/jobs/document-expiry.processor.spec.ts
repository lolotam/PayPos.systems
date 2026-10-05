import { expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import type { ClaimedEvent } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import {
  DOCUMENT_EXPIRY_EVERY_MS,
  DOCUMENT_EXPIRY_QUEUE,
  startDocumentExpiryProcessor,
} from './document-expiry.processor.ts';
import type { DetectDocumentExpiries } from '../use-cases/detect-document-expiries/detect-document-expiries.ts';

const ids = systemUuidV7();
const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;
const event = (eventType: string, companyId = ids.newId()): ClaimedEvent => ({
  companyId,
  id: ids.newId(),
  aggregateId: ids.newId(),
  aggregateType: 'employee',
  eventType,
  payload: {},
  attempt: 1,
});

it('EmployeeDocumentRecorded delivery registers one id-only schedule per company, idempotently, then continues delivery', async () => {
  const prefix = `document-expiry-test-${ids.newId()}`;
  const execute = vi.fn(async () => ({ notified: 0 }));
  const processor = startDocumentExpiryProcessor(
    { execute } as unknown as DetectDocumentExpiries,
    redisUrl,
    prefix,
  );
  const queue = new Queue(DOCUMENT_EXPIRY_QUEUE, { connection: { url: redisUrl }, prefix });
  const next = vi.fn(async () => ({ delivered: true as const }));
  try {
    await processor.ready();
    const first = event('EmployeeDocumentRecorded'),
      second = event('EmployeeDocumentRecorded');
    expect(await processor.deliver(first, next)).toEqual({ delivered: true });
    expect(await processor.deliver(first, next)).toEqual({ delivered: true });
    expect(await processor.deliver(second, next)).toEqual({ delivered: true });
    expect(next).toHaveBeenCalledTimes(3);
    const schedules = await queue.getJobSchedulers();
    expect(schedules.map((s) => s.key).sort()).toEqual(
      [first.companyId, second.companyId].map((c) => `${DOCUMENT_EXPIRY_QUEUE}-${c}`).sort(),
    );
    for (const schedule of schedules) {
      expect(schedule.every).toBe(DOCUMENT_EXPIRY_EVERY_MS);
      expect(Object.keys(schedule.template?.data ?? {})).toEqual(['companyId']);
    }
    await vi.waitFor(
      () => {
        expect(execute).toHaveBeenCalledWith(first.companyId);
        expect(execute).toHaveBeenCalledWith(second.companyId);
      },
      { timeout: 10000 },
    );
  } finally {
    await processor.close();
    await queue.obliterate({ force: true });
    await queue.close();
  }
});

it('other events pass straight through; a scheduling failure is a retryable outcome without delivery', async () => {
  const prefix = `document-expiry-test-${ids.newId()}`;
  const processor = startDocumentExpiryProcessor(
    { execute: vi.fn() } as unknown as DetectDocumentExpiries,
    redisUrl,
    prefix,
  );
  const queue = new Queue(DOCUMENT_EXPIRY_QUEUE, { connection: { url: redisUrl }, prefix });
  const next = vi.fn(async () => ({ delivered: true as const }));
  try {
    await processor.ready();
    expect(await processor.deliver(event('EmployeeDocumentRecorded'), next)).toEqual({
      delivered: true,
    });
    expect(next).toHaveBeenCalledTimes(1);
    next.mockClear();
    expect(await processor.deliver(event('AttendanceClockedIn'), next)).toEqual({
      delivered: true,
    });
    expect(next).toHaveBeenCalledTimes(1);
    await queue.obliterate({ force: true });
    const fail = vi
      .spyOn(Queue.prototype, 'upsertJobScheduler')
      .mockRejectedValueOnce(new Error('synthetic failure'));
    next.mockClear();
    expect(await processor.deliver(event('EmployeeDocumentRecorded'), next)).toEqual({
      delivered: false,
      error: 'DOCUMENT_EXPIRY_SCHEDULE_RETRY',
      retryInMs: 2000,
    });
    expect(next).not.toHaveBeenCalled();
    fail.mockRestore();
  } finally {
    vi.restoreAllMocks();
    await processor.close();
    await queue.obliterate({ force: true });
    await queue.close();
  }
});
