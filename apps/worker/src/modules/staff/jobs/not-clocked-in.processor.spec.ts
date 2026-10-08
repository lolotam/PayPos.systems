import { expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import type { ClaimedEvent } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import {
  ATTENDANCE_NOT_CLOCKED_IN_QUEUE,
  NOT_CLOCKED_IN_EVERY_MS,
  startNotClockedInProcessor,
} from './not-clocked-in.processor.ts';
import type { DetectNotClockedIns } from '../use-cases/detect-not-clocked-in/detect-not-clocked-in.ts';

const ids = systemUuidV7();
const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;
const event = (eventType: string, companyId = ids.newId()): ClaimedEvent => ({
  companyId,
  id: ids.newId(),
  aggregateId: ids.newId(),
  aggregateType: 'company',
  eventType,
  payload: {},
  attempt: 1,
});

it('CompanyCreated registers one id-only schedule per company, idempotently, then continues delivery', async () => {
  const prefix = `attendance-not-clocked-in-test-${ids.newId()}`;
  const execute = vi.fn(async () => ({ notified: 0 }));
  const processor = startNotClockedInProcessor(
    { execute } as unknown as DetectNotClockedIns,
    redisUrl,
    prefix,
  );
  const queue = new Queue(ATTENDANCE_NOT_CLOCKED_IN_QUEUE, { connection: { url: redisUrl }, prefix });
  const next = vi.fn(async () => ({ delivered: true as const }));
  try {
    await processor.ready();
    const first = event('CompanyCreated');
    const second = event('CompanyCreated');
    expect(await processor.deliver(first, next)).toEqual({ delivered: true });
    expect(await processor.deliver(first, next)).toEqual({ delivered: true });
    expect(await processor.deliver(second, next)).toEqual({ delivered: true });
    expect(next).toHaveBeenCalledTimes(3);
    const schedules = await queue.getJobSchedulers();
    expect(schedules.map((item) => item.key).sort()).toEqual(
      [first.companyId, second.companyId]
        .map((companyId) => `${ATTENDANCE_NOT_CLOCKED_IN_QUEUE}-${companyId}`)
        .sort(),
    );
    for (const schedule of schedules) {
      expect(schedule.every).toBe(NOT_CLOCKED_IN_EVERY_MS);
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

it('other events pass through and a Redis failure is retryable without calling next', async () => {
  const prefix = `attendance-not-clocked-in-test-${ids.newId()}`;
  const processor = startNotClockedInProcessor(
    { execute: vi.fn() } as unknown as DetectNotClockedIns,
    redisUrl,
    prefix,
  );
  const queue = new Queue(ATTENDANCE_NOT_CLOCKED_IN_QUEUE, {
    connection: { url: redisUrl },
    prefix,
  });
  const next = vi.fn(async () => ({ delivered: true as const }));
  try {
    await processor.ready();
    expect(await processor.deliver(event('AttendanceClockedOut'), next)).toEqual({
      delivered: true,
    });
    expect(await queue.getJobSchedulers()).toHaveLength(0);
    const fail = vi
      .spyOn(Queue.prototype, 'upsertJobScheduler')
      .mockRejectedValue(new Error('synthetic failure'));
    next.mockClear();
    expect(await processor.deliver(event('CompanyCreated'), next)).toEqual({
      delivered: false,
      error: 'ATTENDANCE_NOT_CLOCKED_IN_SCHEDULE_RETRY',
      retryInMs: 2000,
    });
    expect(next).not.toHaveBeenCalled();
    expect(await processor.deliver(event('AttendanceClockedIn'), next)).toMatchObject({
      delivered: false, error: 'ATTENDANCE_NOT_CLOCKED_IN_SCHEDULE_RETRY',
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

it('AttendanceClockedIn repairs a lost scheduler and reuses the CompanyCreated identity', async () => {
  const prefix = `attendance-not-clocked-in-test-${ids.newId()}`;
  const processor = startNotClockedInProcessor(
    { execute: vi.fn(async () => ({ notified: 0 })) } as unknown as DetectNotClockedIns,
    redisUrl, prefix,
  );
  const queue = new Queue(ATTENDANCE_NOT_CLOCKED_IN_QUEUE, { connection: { url: redisUrl }, prefix });
  const next = vi.fn(async () => ({ delivered: true as const }));
  try {
    await processor.ready();
    const created = event('CompanyCreated');
    const clocked = event('AttendanceClockedIn', created.companyId);
    const key = `${ATTENDANCE_NOT_CLOCKED_IN_QUEUE}-${created.companyId}`;
    await processor.deliver(created, next);
    await queue.removeJobScheduler(key);
    expect(await queue.getJobSchedulers()).toHaveLength(0);
    await processor.deliver(clocked, next);
    await processor.deliver(clocked, next);
    await processor.deliver(created, next);
    const schedules = await queue.getJobSchedulers();
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({
      key, every: NOT_CLOCKED_IN_EVERY_MS, template: { data: { companyId: created.companyId } },
    });
    expect(next).toHaveBeenCalledTimes(4);
  } finally {
    await processor.close();
    await queue.obliterate({ force: true });
    await queue.close();
  }
});
