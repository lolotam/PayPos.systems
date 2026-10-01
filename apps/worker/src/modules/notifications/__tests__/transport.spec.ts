import { systemUuidV7 } from '@pospay/ids';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { notificationRedisOptions } from '../notifications.module.ts';
import { createNotificationTransport } from '../jobs/publish-authorized-notification.ts';
import { logger, notificationHarness } from './harness.ts';

let h: Awaited<ReturnType<typeof notificationHarness>>;
let queue: Queue;
beforeAll(async () => {
  h = await notificationHarness();
  const password = encodeURIComponent(process.env['REDIS_PASSWORD'] ?? '');
  const url = process.env['REDIS_URL'] ?? `redis://:${password}@127.0.0.1:6379`;
  queue = new Queue(`test-notifications-${systemUuidV7().newId()}`, {
    connection: notificationRedisOptions(url),
  });
});
afterAll(async () => {
  await queue.close();
  await h.close();
});

it('Node 24/Redis 7 enqueue dedupe and removed-job recreation preserve the DB fence', async () => {
  const source = await h.request();
  await h.deliver(source);
  const id = await h.attempt(source);
  const event = {
    ...source,
    eventType: 'NotificationSendAuthorized',
    payload: { company_id: source.companyId, attempt_id: id },
  };
  const transport = createNotificationTransport(queue, h.deliver, logger);
  expect(await transport(event)).toEqual({ delivered: true });
  expect(await transport(event)).toEqual({ delivered: true });
  const jobId = `${source.companyId}-${id}`;
  const job = await queue.getJob(jobId);
  expect(job?.data).toEqual(event.payload);
  expect(job?.opts.attempts).toBe(1);
  expect(await queue.getJobCounts('waiting')).toMatchObject({ waiting: 1 });
  await h.module.process({ data: job?.data });
  await job?.remove();
  expect(await transport(event)).toEqual({ delivered: true });
  const recreated = await queue.getJob(jobId);
  await h.module.process({ data: recreated?.data });
  expect(h.channel.calls).toBe(1);
  await recreated?.remove();
});
