import { systemUuidV7 } from '@pospay/ids';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createNotificationTransport } from '../jobs/publish-authorized-notification.ts';
import { notificationRedisOptions } from '../notifications.module.ts';
import { NOW, PHONE, logger, notificationHarness } from './harness.ts';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';

let h: Awaited<ReturnType<typeof notificationHarness>>;
let queue: Queue;

beforeAll(async () => {
  h = await notificationHarness();
  const password = encodeURIComponent(process.env['REDIS_PASSWORD'] ?? '');
  const url = process.env['REDIS_URL'] ?? `redis://:${password}@127.0.0.1:6379`;
  queue = new Queue(`test-lifecycle-${systemUuidV7().newId()}`, {
    connection: notificationRedisOptions(url),
  });
});

afterAll(async () => {
  await queue.close();
  await h.close();
});

describe('removed and recreated BullMQ job on non-pending attempts', () => {
  it('makes zero provider calls when attempt is already SENDING', async () => {
    h.channel.outcome = 'crash';
    const source = await h.request();
    await h.deliver(source);
    const id = await h.attempt(source);
    await expect(h.module.send.execute(source.companyId, id)).rejects.toThrow('FAKE_EXECUTION_CRASH');
    expect(await h.read(id)).toMatchObject({ status: 'SENDING' });
    const callsBefore = h.channel.calls;
    h.channel.outcome = 'accepted';

    const transport = createNotificationTransport(queue, h.deliver, logger);
    const event = {
      ...source,
      eventType: 'NotificationSendAuthorized',
      payload: { company_id: source.companyId, attempt_id: id },
    };
    await transport(event);
    const jobId = `${source.companyId}-${id}`;
    const job = await queue.getJob(jobId);
    await job?.remove();

    await transport(event);
    const recreated = await queue.getJob(jobId);
    expect(recreated).not.toBeNull();
    await h.module.process({ data: recreated?.data });
    expect(h.channel.calls).toBe(callsBefore);
    expect(await h.read(id)).toMatchObject({ status: 'SENDING' });
    await recreated?.remove();
  });

  it('makes zero provider calls when attempt is terminal FAILED', async () => {
    const source = await h.request({ locale: 'fr' });
    await h.deliver(source);
    const id = await h.attempt(source);
    expect(await h.read(id)).toMatchObject({ status: 'FAILED' });
    const callsBefore = h.channel.calls;

    const transport = createNotificationTransport(queue, h.deliver, logger);
    const event = {
      ...source,
      eventType: 'NotificationSendAuthorized',
      payload: { company_id: source.companyId, attempt_id: id },
    };
    await transport(event);
    const jobId = `${source.companyId}-${id}`;
    const job = await queue.getJob(jobId);
    await job?.remove();

    await transport(event);
    const recreated = await queue.getJob(jobId);
    expect(recreated).not.toBeNull();
    await h.module.process({ data: recreated?.data });
    expect(h.channel.calls).toBe(callsBefore);
    expect(await h.read(id)).toMatchObject({ status: 'FAILED' });
    await recreated?.remove();
  });
});

describe('null deadline behavior', () => {
  it('sends to provider when send_deadline is null', async () => {
    const beforeCalls = h.channel.calls;
    const source = await h.request({ send_deadline: null });
    await h.deliver(source);
    const id = await h.attempt(source);
    const rowBefore = await h.read(id);
    expect(rowBefore).toMatchObject({
      status: 'PENDING',
      send_deadline: null,
      recipient_phone: PHONE,
    });
    await h.module.send.execute(source.companyId, id);
    expect(h.channel.calls).toBe(beforeCalls + 1);
    const rowAfter = await h.read(id);
    expect(rowAfter).toMatchObject({
      status: 'SENT',
      recipient_phone: null,
      provider_message_id: 'fake-message-id',
    });
    const deliveredEvents = (await h.events()).filter(
      (e) => e.payload['attempt_id'] === id && e.event_type === 'NotificationDelivered',
    );
    expect(deliveredEvents).toHaveLength(1);
  });
});

describe('cleanup dedupe preservation', () => {
  it('preserves dedupe after cleanup so duplicate event causes no send or attempt', async () => {
    h.channel.outcome = 'crash';
    const source = await h.request();
    await h.deliver(source);
    const id = await h.attempt(source);
    await expect(h.module.send.execute(source.companyId, id)).rejects.toThrow('FAKE_EXECUTION_CRASH');
    const before = await h.read(id);
    expect(before).toMatchObject({ status: 'SENDING', recipient_phone: PHONE });

    h.advance(new Date(NOW.getTime() + 25 * 60 * 60 * 1_000));
    const cleaned = await h.module.cleanup({
      company_id: source.companyId,
      attempt_id: id,
      execution_id: String(before?.['execution_id']),
      operator_id: USER,
      execution_stopped: true,
    });
    expect(cleaned).toBe(true);
    const after = await h.read(id);
    expect(after).toMatchObject({ status: 'SENDING', recipient_phone: null });

    const callsBefore = h.channel.calls;
    // Re-delivering the exact same source event should be a no-op
    await h.deliver(source);
    expect(h.channel.calls).toBe(callsBefore);

    // Assert only one row exists for this source event id
    const rows = await h.db.withTenant(source.companyId, (tx) =>
      tx.execute(sql`SELECT id FROM notification_attempts WHERE source_event_id = ${source.id}`),
    );
    expect(rows).toHaveLength(1);

    // Direct insert with duplicate identity is rejected by the unique constraint
    await expect(
      h.db.withTenant(source.companyId, (tx) =>
        tx.execute(sql`
          INSERT INTO notification_attempts (company_id, id, source_event_id, channel, template_key,
            template_revision, locale, provider_template_name, recipient_phone, recipient_hash,
            hash_key_id, phone_last3, safe_parameters, status, authorized_at, created_at, updated_at)
          VALUES (${source.companyId}, ${systemUuidV7().newId()}, ${source.id}, 'whatsapp', 'test_notice',
            1, 'ar', 'test_notice_ar', '+96500000001', ${after?.['recipient_hash']}, 'test-v1', '001',
            '[]', 'PENDING', now(), now(), now())`),
      ),
    ).rejects.toThrow();

    // Sending again makes no provider call
    await h.module.send.execute(source.companyId, id);
    expect(h.channel.calls).toBe(callsBefore);
    h.advance(NOW);
  });
});
