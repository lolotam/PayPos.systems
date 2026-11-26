import type { ClaimedEvent } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { Queue, Worker } from 'bullmq';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createPushTransport } from '../jobs/push-queue.ts';
import { notificationRedisOptions } from '../notifications.module.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000a1';
const password = encodeURIComponent(process.env['REDIS_PASSWORD'] || 'pospay_dev_redis');
const url = process.env['REDIS_URL'] || `redis://:${password}@127.0.0.1:6379`;
const logger = createLogger('silent');
const delivered = async () => ({ delivered: true as const });

let queue: Queue;

beforeAll(() => {
  queue = new Queue(`test-push-replay-${systemUuidV7().newId()}`, {
    connection: notificationRedisOptions(url),
  });
});
afterAll(async () => {
  await queue.obliterate({ force: true });
  await queue.close();
});

const event = (attempt: string): ClaimedEvent => ({
  id: attempt,
  companyId: COMPANY,
  aggregateType: 'push_attempt',
  aggregateId: attempt,
  eventType: 'PushSendAuthorized',
  payload: { company_id: COMPANY, attempt_id: attempt },
  attempt: 1,
});

// مهمة فشلت واتسابت: الطابور بيحتفظ بيها 7 أيام وبيتجاهل أي add بنفس المعرّف.
async function failedJob(attempt: string): Promise<string> {
  const jobId = `${COMPANY}-${attempt}`;
  const worker = new Worker(
    queue.name,
    async () => {
      throw new Error('PUSH_PROCESSING_FAILED');
    },
    { connection: notificationRedisOptions(url) },
  );
  // المهام اللي سابقتها في نفس الطابور بتفشل هي كمان، فبنستنى فشل مهمتنا بالذات.
  const failed = new Promise<void>((resolve) =>
    worker.on('failed', (job) => {
      if (job?.id === jobId) resolve();
    }),
  );
  await queue.add('send', { company_id: COMPANY, attempt_id: attempt }, { jobId });
  await failed;
  await worker.close();
  expect(await (await queue.getJob(jobId))?.isFailed()).toBe(true);
  return jobId;
}

it('re-queues the failed job instead of acknowledging a replay BullMQ ignored', async () => {
  const attempt = '01920000-0000-7000-8000-0000000000b2';
  const jobId = await failedJob(attempt);
  expect((await queue.getJob(jobId))?.attemptsMade).toBeGreaterThanOrEqual(1);
  const transport = createPushTransport(queue, delivered, logger);
  expect(await transport(event(attempt))).toEqual({ delivered: true });
  const retried = await queue.getJob(jobId);
  expect(await retried?.getState()).toBe('waiting');
  expect(retried?.attemptsMade).toBe(0);
});

it('does not retry a job that is still waiting', async () => {
  const attempt = '01920000-0000-7000-8000-0000000000b3';
  const transport = createPushTransport(queue, delivered, logger);
  expect(await transport(event(attempt))).toEqual({ delivered: true });
  expect(await transport(event(attempt))).toEqual({ delivered: true });
  const job = await queue.getJob(`${COMPANY}-${attempt}`);
  expect(await job?.getState()).toBe('waiting');
  expect(job?.attemptsMade).toBe(0);
});

it('reports not delivered when the failed job cannot be re-queued', async () => {
  const attempt = '01920000-0000-7000-8000-0000000000b4';
  const jobId = await failedJob(attempt);
  const failing = {
    add: queue.add.bind(queue),
    getJob: async () => {
      const job = await queue.getJob(jobId);
      if (job === undefined) throw new Error('TEST_JOB_MISSING');
      job.retry = async () => {
        throw new Error('redis connection refused');
      };
      return job;
    },
  } as unknown as Pick<Queue, 'add' | 'getJob'>;
  const transport = createPushTransport(failing, delivered, logger);
  expect(await transport(event(attempt))).toMatchObject({
    delivered: false,
    error: expect.any(String),
    retryInMs: 5000,
  });
});
