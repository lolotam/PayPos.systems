import { systemUuidV7 } from '@pospay/ids';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { retryDelayMs } from '../../../../outbox/retry-policy.ts';
import {
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
  const queue = new Queue(RATING_CLAIMS_QUEUE, { connection: new Redis(redisUrl), prefix });
  cleanups.push(async () => {
    await processor.close();
    const schedulers = await queue.getJobSchedulers();
    for (const scheduler of schedulers) await queue.removeJobScheduler(scheduler.key);
    await queue.obliterate({ force: true });
    await queue.close();
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

const next = async (_event: ClaimedEvent): Promise<DeliveryOutcome> => ({ delivered: true });

describe('معالج مطالبة طلبات التقييم', () => {
  it('registration_backoff_follows_pp97', async () => {
    const world = await harness();
    const companyId = ids.newId();
    const spy = vi
      .spyOn(Queue.prototype, 'upsertJobScheduler')
      .mockRejectedValue(new Error('SYNTHETIC_SCHEDULER_FAILURE'));
    const delays: (number | null)[] = [];
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const outcome = await world.processor.deliver(triggerEvent(companyId, attempt), next);
      expect(outcome.delivered).toBe(false);
      if (!outcome.delivered) {
        expect(outcome.error).toBe('RATING_CLAIMS_SCHEDULE_RETRY');
        delays.push(outcome.retryInMs);
      }
    }
    spy.mockRestore();
    expect(delays.slice(0, 9)).toEqual([
      5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 320_000, 640_000, 1_280_000,
    ]);
    expect(delays.reduce((total, delay) => total + (delay ?? 0), 0)).toBe(2_555_000);
    expect(delays[9]).toBeNull();
    expect(retryDelayMs(10)).toBeNull();
  });

  it('trigger_preserves_running_progress', async () => {
    const world = await harness();
    const companyId = ids.newId();
    const schedulerId = `${RATING_CLAIMS_QUEUE}-${companyId}`;
    await world.processor.deliver(triggerEvent(companyId), next);
    const first = await world.queue.getJobScheduler(schedulerId);
    expect(first?.template?.data).toEqual({ companyId });
    const spy = vi.spyOn(Queue.prototype, 'upsertJobScheduler');
    await world.processor.deliver(triggerEvent(companyId), next);
    spy.mockRestore();
    expect(spy).not.toHaveBeenCalled();
    const second = await world.queue.getJobScheduler(schedulerId);
    expect(second?.template?.data).toEqual({ companyId });
  });

  it('new_visit_registers_without_discovery', async () => {
    const world = await harness();
    const companyId = ids.newId();
    let delegated = 0;
    const counting = async (_event: ClaimedEvent): Promise<DeliveryOutcome> => {
      delegated += 1;
      return { delivered: true };
    };
    for (const trigger of RATING_CLAIMS_TRIGGERS) {
      await world.processor.deliver(triggerEvent(companyId, 1, trigger), counting);
    }
    expect(delegated).toBe(RATING_CLAIMS_TRIGGERS.length);
    const schedulers = await world.queue.getJobSchedulers();
    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]?.key).toBe(`${RATING_CLAIMS_QUEUE}-${companyId}`);
    expect(schedulers[0]?.template?.data).toEqual({ companyId });
  });

  it('refuses a legacy job that still carries the page cursor', async () => {
    const world = await harness();
    await world.processor.ready();
    const events = new QueueEvents(RATING_CLAIMS_QUEUE, {
      connection: new Redis(redisUrl),
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

  it('ensureRegistered_is_idempotent', async () => {
    const world = await harness();
    const companyId = ids.newId();
    await world.processor.ensureRegistered(companyId);
    const spy = vi.spyOn(Queue.prototype, 'upsertJobScheduler');
    await world.processor.ensureRegistered(companyId);
    spy.mockRestore();
    expect(spy).not.toHaveBeenCalled();
    const schedulers = await world.queue.getJobSchedulers();
    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]?.template?.data).toEqual({ companyId });
  });
});
