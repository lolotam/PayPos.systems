import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import { createLogger } from '@pospay/observability';
import type { Queue } from 'bullmq';
import { expect, it } from 'vitest';

import { createPushTransport } from '../jobs/push-queue.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000a1';
const ATTEMPT = '01920000-0000-7000-8000-0000000000b1';
const EVENT = '01920000-0000-7000-8000-0000000000c1';

interface Added {
  readonly name: string;
  readonly data: unknown;
  readonly opts: unknown;
}

function fakeQueue() {
  const added: Added[] = [];
  const queue = {
    add: async (name: string, data: unknown, opts: unknown) => {
      added.push({ name, data, opts });
      return { id: 'job' };
    },
  };
  return { added, queue: queue as unknown as Pick<Queue, 'add'> };
}

function claimed(over: Partial<ClaimedEvent> = {}): ClaimedEvent {
  return {
    id: EVENT,
    companyId: COMPANY,
    aggregateType: 'push_attempt',
    aggregateId: ATTEMPT,
    eventType: 'PushSendAuthorized',
    payload: { company_id: COMPANY, attempt_id: ATTEMPT },
    attempt: 1,
    ...over,
  };
}

const lines: string[] = [];
const logger = createLogger('info', {
  events: ['push enqueue failed'],
  destination: {
    write: (line: string) => {
      lines.push(line);
    },
  },
});

const delivered = async (): Promise<DeliveryOutcome> => ({ delivered: true });

it('enqueues one id-only job for an authorized attempt', async () => {
  const queue = fakeQueue();
  const transport = createPushTransport(queue.queue, delivered, logger);
  expect(await transport(claimed())).toEqual({ delivered: true });
  expect(queue.added).toHaveLength(1);
  expect(queue.added[0]?.name).toBe('send');
  expect(queue.added[0]?.data).toEqual({ company_id: COMPANY, attempt_id: ATTEMPT });
  expect(queue.added[0]?.opts).toMatchObject({
    jobId: `${COMPANY}-${ATTEMPT}`,
    attempts: 1,
  });
});

it('another event type goes to the next deliverer and the queue is untouched', async () => {
  const queue = fakeQueue();
  let handed = 0;
  const transport = createPushTransport(
    queue.queue,
    async () => {
      handed += 1;
      return { delivered: true };
    },
    logger,
  );
  expect(await transport(claimed({ eventType: 'NotificationFailed' }))).toEqual({
    delivered: true,
  });
  expect(handed).toBe(1);
  expect(queue.added).toHaveLength(0);
});

it('a payload that does not parse is retried and never enqueued', async () => {
  const queue = fakeQueue();
  const transport = createPushTransport(queue.queue, delivered, logger);
  const result = await transport(claimed({ payload: { company_id: COMPANY } }));
  expect(result.delivered).toBe(false);
  expect(queue.added).toHaveLength(0);
  expect(result).toMatchObject({ error: expect.any(String), retryInMs: 5000 });
});

it('a payload of another company is retried and never enqueued', async () => {
  const queue = fakeQueue();
  const transport = createPushTransport(queue.queue, delivered, logger);
  const result = await transport(
    claimed({
      payload: { company_id: '01920000-0000-7000-8000-0000000000d1', attempt_id: ATTEMPT },
    }),
  );
  expect(result.delivered).toBe(false);
  expect(queue.added).toHaveLength(0);
});

it('a queue that refuses the job is retried', async () => {
  const refusing = {
    add: async () => {
      throw new Error('redis connection refused');
    },
  } as unknown as Pick<Queue, 'add'>;
  const transport = createPushTransport(refusing, delivered, logger);
  const result = await transport(claimed());
  expect(result.delivered).toBe(false);
  expect(result).toMatchObject({ error: expect.any(String) });
});

it('neither the returned error nor the warn line carries the payload', async () => {
  lines.length = 0;
  const queue = fakeQueue();
  const transport = createPushTransport(queue.queue, delivered, logger);
  const result = await transport(
    claimed({ payload: { company_id: COMPANY, attempt_id: 'secret-token-value' } }),
  );
  const text = lines.join('');
  expect(text).not.toContain('secret-token-value');
  expect(JSON.stringify(result)).not.toContain('secret-token-value');
  expect(text).toContain('push enqueue failed');
});
