import type { ClaimedEvent } from '@pospay/db';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createPushTransport } from '../jobs/push-queue.ts';
import { pushProcessor } from '../jobs/push-send.processor.ts';
import { logger } from './harness.ts';
import { pushSendHarness } from './push-send-harness.ts';

let h: Awaited<ReturnType<typeof pushSendHarness>>;

interface Added {
  readonly data: unknown;
}

function fakeQueue() {
  const added: Added[] = [];
  const queue = {
    add: async (_name: string, data: unknown) => {
      added.push({ data });
      return { id: 'job' };
    },
  };
  return { added, queue: queue as unknown as Pick<Queue, 'add'> };
}

function claimed(payload: unknown): ClaimedEvent {
  const data = payload as { company_id: string; attempt_id: string };
  return {
    id: data.attempt_id,
    companyId: data.company_id,
    aggregateType: 'push_attempt',
    aggregateId: data.attempt_id,
    eventType: 'PushSendAuthorized',
    payload,
    attempt: 1,
  };
}

beforeAll(async () => {
  h = await pushSendHarness();
});
afterAll(async () => {
  await h.close();
});

it('turns an authorized attempt into a sent attempt through the queue', async () => {
  const { attemptId, eventId } = await h.authorizeAttempt('ar');
  const authorized = await h.authorized(eventId);
  expect(authorized).toHaveLength(1);
  const queue = fakeQueue();
  const transport = createPushTransport(queue.queue, async () => ({ delivered: true }), logger);
  for (const row of authorized) await transport(claimed(row['payload']));
  expect(queue.added).toHaveLength(1);
  const processor = pushProcessor(h.send, logger);
  for (const job of queue.added) await processor({ data: job.data });
  const [row] = await h.attempt(attemptId);
  expect(row).toMatchObject({
    status: 'SENT',
    http_status: 201,
    failure_code: null,
    outcome_known: true,
  });
  expect(h.channel.calls).toBe(1);
  expect(JSON.parse(h.channel.requests[0]?.payload ?? '{}')).toMatchObject({ lang: 'ar' });
  const events = await h.events(attemptId);
  expect(events).toHaveLength(1);
  expect(events[0]?.['event_type']).toBe('NotificationDelivered');
});

it('running the same job again sends nothing more', async () => {
  const { attemptId, eventId } = await h.authorizeAttempt('en');
  const authorized = await h.authorized(eventId);
  const queue = fakeQueue();
  const transport = createPushTransport(queue.queue, async () => ({ delivered: true }), logger);
  for (const row of authorized) await transport(claimed(row['payload']));
  const processor = pushProcessor(h.send, logger);
  for (const job of queue.added) await processor({ data: job.data });
  const before = h.channel.calls;
  for (const job of queue.added) await processor({ data: job.data });
  expect(h.channel.calls).toBe(before);
  const [row] = await h.attempt(attemptId);
  expect(row).toMatchObject({ status: 'SENT' });
});
