import { systemUuidV7 } from '@pospay/ids';
import { createLogger, type DestinationStream } from '@pospay/observability';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDeliverer } from '../../../outbox/deliver.ts';
import { createNotificationTransport } from '../jobs/publish-authorized-notification.ts';
import { notificationRedisOptions } from '../notifications.module.ts';
import { PHONE, notificationHarness } from './harness.ts';

let h: Awaited<ReturnType<typeof notificationHarness>>;
let queue: Queue;

beforeAll(async () => {
  h = await notificationHarness();
  const password = encodeURIComponent(process.env['REDIS_PASSWORD'] ?? '');
  const url = process.env['REDIS_URL'] ?? `redis://:${password}@127.0.0.1:6379`;
  queue = new Queue(`test-privacy-${systemUuidV7().newId()}`, {
    connection: notificationRedisOptions(url),
  });
});

afterAll(async () => {
  await queue.close();
  await h.close();
});

describe('payload and job data privacy', () => {
  it('NotificationFailed payload retains only safe metadata and never contains full phone', async () => {
    const event = await h.request({ locale: 'fr' });
    await h.deliver(event);
    const id = await h.attempt(event);
    const attemptRow = await h.read(id);
    expect(attemptRow).toMatchObject({ status: 'FAILED', recipient_phone: null });

    const failedEvents = (await h.events()).filter(
      (e) => e.event_type === 'NotificationFailed' && e.payload['attempt_id'] === id,
    );
    expect(failedEvents).toHaveLength(1);
    const payloadText = JSON.stringify(failedEvents[0]?.payload);
    for (const forbidden of [PHONE, 'recipient_hash', 'safe_parameters', 'test-key', 'test-token']) {
      expect(payloadText).not.toContain(forbidden);
    }
    expect(failedEvents[0]?.payload).toMatchObject({
      company_id: event.companyId,
      attempt_id: id,
      source_event_id: event.id,
      status: 'FAILED',
      evidence: 'NONE',
      failure_code: 'LOCALE_UNSUPPORTED',
      outcome_known: true,
    });
  });

  it('BullMQ job data contains only company_id and attempt_id without destination', async () => {
    const source = await h.request();
    await h.deliver(source);
    const id = await h.attempt(source);
    const transport = createNotificationTransport(queue, h.deliver, h.module.send.channel as never);
    const authEvent = {
      ...source,
      eventType: 'NotificationSendAuthorized',
      payload: { company_id: source.companyId, attempt_id: id },
    };
    await transport(authEvent);
    const jobId = `${source.companyId}-${id}`;
    const job = await queue.getJob(jobId);
    expect(job).not.toBeNull();
    const jobJson = JSON.stringify(job?.data);
    expect(jobJson).not.toContain(PHONE);
    expect(job?.data).toEqual({ company_id: source.companyId, attempt_id: id });
    await job?.remove();
  });
});

describe('captured logger privacy', () => {
  it('captured logger output never contains the recipient phone during delivery and diagnostics', async () => {
    const logChunks: string[] = [];
    const stream: DestinationStream = {
      write(chunk: string) {
        logChunks.push(chunk);
      },
    };
    const capturingLogger = createLogger('info', { destination: stream });

    const deliver = createDeliverer(h.db, [h.module.consumer], capturingLogger, {
      knownEventTypes: h.module.eventTypes,
    });

    const normalEvent = await h.request();
    await deliver(normalEvent);

    const failedEvent = await h.request({ locale: 'unsupported-locale' });
    await deliver(failedEvent);

    const unknownEvent = {
      ...normalEvent,
      id: systemUuidV7().newId(),
      eventType: 'UnknownEventTypeForTest',
    };
    await deliver(unknownEvent);

    const transport = createNotificationTransport(queue, deliver, capturingLogger);
    const badAuthEvent = {
      ...normalEvent,
      id: systemUuidV7().newId(),
      eventType: 'NotificationSendAuthorized',
      payload: { company_id: 'wrong-company', attempt_id: 'bad-id' },
    };
    await transport(badAuthEvent);

    const allLogs = logChunks.join('\n');
    expect(allLogs).not.toContain(PHONE);
  });
});
