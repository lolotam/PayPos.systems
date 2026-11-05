import { systemUuidV7 } from '@pospay/ids';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { retryDelayMs } from '../../../../outbox/retry-policy.ts';
import {
  closeRedisClient,
  RATING_CLAIMS_QUEUE,
  RATING_CLAIMS_TRIGGERS,
  startRatingClaimsProcessor,
  type RatingClaimsProcessor,
} from '../rating-claims.processor.ts';

const ids = systemUuidV7();
const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;

interface Harness {
  readonly processor: RatingClaimsProcessor;
  readonly queue: Queue;
  readonly prefix: string;
  readonly turns: string[];
}

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0, cleanups.length)) await cleanup();
});

/** معالج ببرفكس خاص بالاختبار، وكل مفتاحه بتاعه بس. */
async function harness(): Promise<Harness> {
  const prefix = `pospay-test-rating-claims-${ids.newId()}`;
  const turns: string[] = [];
  const processor = startRatingClaimsProcessor({
    redisUrl,
    prefix,
    turn: {
      execute: async (companyId) => {
        turns.push(companyId);
        return {
          settlements: {
            TERMINAL: 0,
            ABSENT: 0,
            FUTURE_UNATTEMPTED: 0,
            RETRY: 0,
            DELEGATED: 0,
          },
          forwardVisits: 0,
          retryVisits: 0,
          end: 'COMPLETED',
        };
      },
    },
  });
  const connection = new Redis(redisUrl);
  const queue = new Queue(RATING_CLAIMS_QUEUE, { connection, prefix });
  cleanups.push(async () => {
    await processor.close();
    const schedulers = await queue.getJobSchedulers();
    for (const scheduler of schedulers) await queue.removeJobScheduler(scheduler.key);
    await queue.obliterate({ force: true });
    await queue.close();
    // BullMQ مش بيقفل اتصال مُسلّم له، فقفل الاتصال علينا.
    await closeRedisClient(connection);
  });
  return { processor, queue, prefix, turns };
}

function triggerEvent(companyId: string, attempt = 1, eventType = 'ServiceSessionRecorded') {
  return {
    companyId,
    id: ids.newId(),
    aggregateType: 'service_session',
    aggregateId: ids.newId(),
    eventType,
    payload: {},
    attempt,
  } satisfies ClaimedEvent;
}

const next = async (): Promise<DeliveryOutcome> => ({ delivered: true });

/**
 * ينتظر لحد ما الشرط يتحقق، بحدّ زمني وفواصل قصيرة، من غير نوم ثابت.
 *
 * الجدولة بتنفّذ أول دورة فورًا والتالية بتتأجل، فالقياس لازم يستنى لحد ما
 * الدورة الأولى تشتغل والمهمة المؤجلة تظهر.
 */
async function waitUntil(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('RATING_CLAIMS_TEST_TIMEOUT');
}

describe('معالج مطالبة طلبات التقييم', () => {
  it('registration_backoff_follows_pp97', async () => {
    const world = await harness();
    const companyId = ids.newId();
    const spy = vi
      .spyOn(Queue.prototype, 'upsertJobScheduler')
      .mockRejectedValue(new Error('SYNTHETIC_SCHEDULER_FAILURE'));
    const delays: (number | null)[] = [];
    try {
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        const outcome = await world.processor.deliver(triggerEvent(companyId, attempt), next);
        expect(outcome.delivered).toBe(false);
        if (!outcome.delivered) {
          expect(outcome.error).toBe('RATING_CLAIMS_SCHEDULE_RETRY');
          delays.push(outcome.retryInMs);
        }
      }
    } finally {
      spy.mockRestore();
    }
    const firstNine = delays.slice(0, 9);
    expect(firstNine).toEqual([
      5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 320_000, 640_000, 1_280_000,
    ]);
    const numeric = firstNine.filter((delay): delay is number => delay !== null);
    expect(numeric.reduce((total, delay) => total + delay, 0)).toBe(2_555_000);
    expect(delays[9]).toBeNull();
    expect(retryDelayMs(10)).toBeNull();
  });
});

describe('تقدّم الجدولة', () => {
  it('trigger_preserves_running_progress', async () => {
    const world = await harness();
    const companyId = ids.newId();
    const schedulerId = `${RATING_CLAIMS_QUEUE}-${companyId}`;
    await world.processor.deliver(triggerEvent(companyId), next);
    // أول دورة بتنفّذ فورًا والتالية بتتأجل، فالمقارنة بتتم بعد ما يبان
    // إن الدورة الأولى اشتغلت وإن في مهمة مؤجلة واحدة بس.
    await waitUntil(
      async () => world.turns.length === 1 && (await world.queue.getDelayed()).length === 1,
    );
    const first = await world.queue.getJobScheduler(schedulerId);
    expect(first).toBeDefined();
    expect(first?.template?.data).toEqual({ companyId });
    const firstNext = first?.next;
    const firstIteration = first?.iterationCount;
    const delayedBefore = (await world.queue.getDelayed()).map(
      (job) => `${job.id ?? ''}@${job.timestamp}`,
    );
    expect(delayedBefore).toHaveLength(1);
    const spy = vi.spyOn(Queue.prototype, 'upsertJobScheduler');
    try {
      await world.processor.deliver(triggerEvent(companyId), next);
    } finally {
      spy.mockRestore();
    }
    expect(spy).not.toHaveBeenCalled();
    const second = await world.queue.getJobScheduler(schedulerId);
    expect(second?.template?.data).toEqual({ companyId });
    // الجدولة نفسها ما اتغيّرتش: ميعاد الدور، ورقم الدورة، والمهمة المؤجلة.
    expect(second?.next).toBe(firstNext);
    expect(second?.iterationCount).toBe(firstIteration);
    const delayedAfter = (await world.queue.getDelayed()).map(
      (job) => `${job.id ?? ''}@${job.timestamp}`,
    );
    expect(delayedAfter).toEqual(delayedBefore);
  });
});

describe('أحداث الزيارة', () => {
  it('new_visit_registers_without_discovery', async () => {
    const world = await harness();
    const companyId = ids.newId();
    let delegated = 0;
    const counting = async (): Promise<DeliveryOutcome> => {
      delegated += 1;
      return { delivered: true };
    };
    for (const trigger of RATING_CLAIMS_TRIGGERS) {
      await world.processor.deliver(triggerEvent(companyId, 1, trigger), counting);
    }
    expect(delegated).toBe(RATING_CLAIMS_TRIGGERS.length);
    // الزيارة بتسجّل الجدولة بس: الدور بييجي من أول دورة للجدولة نفسها، ودور
    // واحد بس مهما كان عدد أحداث الزيارة، فالدور التاني بيستنى ميعاده.
    await waitUntil(async () => world.turns.length >= 1);
    expect(world.turns).toEqual([companyId]);
    const schedulers = await world.queue.getJobSchedulers();
    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]?.key).toBe(`${RATING_CLAIMS_QUEUE}-${companyId}`);
    expect(schedulers[0]?.template?.data).toEqual({ companyId });
  });

  it('ensureRegistered_is_idempotent', async () => {
    const world = await harness();
    const companyId = ids.newId();
    await world.processor.ensureRegistered(companyId);
    const spy = vi.spyOn(Queue.prototype, 'upsertJobScheduler');
    try {
      await world.processor.ensureRegistered(companyId);
    } finally {
      spy.mockRestore();
    }
    expect(spy).not.toHaveBeenCalled();
    const schedulers = await world.queue.getJobSchedulers();
    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]?.template?.data).toEqual({ companyId });
  });
});

describe('بيانات المهمة', () => {
  it('refuses a legacy job that still carries the page cursor', async () => {
    const world = await harness();
    await world.processor.ready();
    const events = new QueueEvents(RATING_CLAIMS_QUEUE, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
      prefix: world.prefix,
    });
    try {
      await events.waitUntilReady();
      const job = await world.queue.add(
        'claim',
        { companyId: ids.newId(), after: { dueAt: '2026-01-01T00:00:00.000Z', id: ids.newId() } },
        { attempts: 1 },
      );
      await expect(job.waitUntilFinished(events)).rejects.toThrow(/RATING_CLAIMS_JOB_INVALID/);
    } finally {
      await events.close();
    }
  });

  it('an_invalid_job_fails_once_without_retries', async () => {
    const world = await harness();
    await world.processor.ready();
    const events = new QueueEvents(RATING_CLAIMS_QUEUE, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
      prefix: world.prefix,
    });
    try {
      await events.waitUntilReady();
      const job = await world.queue.add(
        'claim',
        { companyId: ids.newId(), after: { dueAt: '2026-01-01T00:00:00.000Z', id: ids.newId() } },
        { attempts: 3, backoff: { type: 'fixed', delay: 50 } },
      );
      await expect(job.waitUntilFinished(events)).rejects.toThrow(/RATING_CLAIMS_JOB_INVALID/);
      // بيانات غلط مش عطل مؤقت: المهمة بتفشل مرة واحدة بس من غير إعادة محاولة.
      const stored = await world.queue.getJob(job.id ?? '');
      expect(stored?.attemptsMade).toBe(1);
      expect(await stored?.getState()).toBe('failed');
      expect(world.turns).toHaveLength(0);
    } finally {
      await events.close();
    }
  }, 60_000);
});

describe('إقفال المعالج', () => {
  it('closes_the_queue_and_the_clients_even_when_the_worker_fails', async () => {
    const world = await harness();
    const workerSpy = vi
      .spyOn(Worker.prototype, 'close')
      .mockRejectedValue(new Error('SYNTHETIC_WORKER_CLOSE_FAILURE'));
    const queueSpy = vi.spyOn(Queue.prototype, 'close');
    const quitSpy = vi.spyOn(Redis.prototype, 'quit');
    const disconnectSpy = vi.spyOn(Redis.prototype, 'disconnect');
    try {
      // أول خطأ بيت رمي، بس الطابور واتصالات Redis اتقفلوا قبله.
      await expect(world.processor.close()).rejects.toThrow('SYNTHETIC_WORKER_CLOSE_FAILURE');
      expect(queueSpy).toHaveBeenCalled();
      const closed = new Set([...quitSpy.mock.instances, ...disconnectSpy.mock.instances]);
      expect(closed.size).toBeGreaterThanOrEqual(2);
    } finally {
      workerSpy.mockRestore();
      queueSpy.mockRestore();
      quitSpy.mockRestore();
      disconnectSpy.mockRestore();
    }
  }, 60_000);
});
