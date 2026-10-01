import type { ClaimedEvent } from '@pospay/db';
import { notificationResult } from '@pospay/contracts';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { USER, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  OTHER_INBOX_USER,
  seedInboxUsers,
} from '../../../../../../packages/db/test/in-app-fixtures.ts';
import { notificationHarness } from './harness.ts';

let h: Awaited<ReturnType<typeof notificationHarness>>;
let owner: postgres.Sql;
const recipient = (user = USER) => ({
  channel: 'IN_APP',
  user_id: user,
  locale: 'ar',
  template_key: 'generic_notice',
  template_revision: 1,
  safe_parameters: [{ name: 'subject', type: 'text', value: 'Synthetic subject' }],
});

beforeAll(async () => {
  h = await notificationHarness();
  owner = postgres(h.testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedInboxUsers(owner);
});
afterAll(async () => {
  await owner.end();
  await h.close();
});

async function event(recipients: object[]): Promise<ClaimedEvent> {
  const original = await h.request();
  return {
    ...original,
    payload: {
      business_id: TENANT.A.business,
      branch_id: TENANT.A.branch,
      notification_recipients: recipients,
    },
  };
}

it('creates each recipient once in the consumer transaction and emits only durable in-app results', async () => {
  const request = await event([recipient(), recipient(OTHER_INBOX_USER), recipient()]);
  expect(await h.deliver(request)).toEqual({ delivered: true });
  expect(await h.deliver(request)).toEqual({ delivered: true });
  // Bypass consumer dedupe to prove table uniqueness remains the authority after source retention.
  await h.db.withTenant(request.companyId, (tx) => h.module.consumer.handle(tx, request));
  const rows =
    await owner`SELECT * FROM in_app_notifications WHERE source_event_id = ${request.id}`;
  expect(rows).toHaveLength(2);
  expect(
    rows.every((row) => row['read_at'] === null && row['business_id'] === TENANT.A.business),
  ).toBe(true);
  const results = (await h.events()).filter(
    (e) => e.event_type === 'NotificationDelivered' && e.payload['source_event_id'] === request.id,
  );
  expect(results).toHaveLength(2);
  results.forEach((result) => {
    expect(notificationResult.parse(result.payload)).toEqual(result.payload);
    expect(result.payload['evidence']).toBe('IN_APP_STORED');
    expect(result.payload['channel']).toBe('IN_APP');
    for (const privateKey of ['safe_parameters', 'recipient_phone', 'recipient_hash'])
      expect(result.payload).not.toHaveProperty(privateKey);
  });
  expect(
    (await h.events()).filter((e) => e.event_type === 'NotificationSendAuthorized'),
  ).toHaveLength(0);
  expect(h.channel.calls).toBe(0);
});

it('rollback after handle leaves no inbox, result or consumer dedupe', async () => {
  const request = await event([recipient()]);
  await expect(
    h.db.withTenant(request.companyId, async (tx) => {
      await h.module.consumer.handle(tx, request);
      throw new Error('synthetic rollback');
    }),
  ).rejects.toThrow('synthetic rollback');
  expect(
    await owner`SELECT id FROM in_app_notifications WHERE source_event_id = ${request.id}`,
  ).toHaveLength(0);
  expect(
    (await h.events()).filter((e) => e.payload['source_event_id'] === request.id),
  ).toHaveLength(0);
  expect(await h.deliver(request)).toEqual({ delivered: true });
});

it('a late recipient FK failure rolls back the first row/result and dedupe so redelivery can recover', async () => {
  const request = await event([recipient(), recipient('01920000-0000-7000-8000-0000000000ff')]);
  expect((await h.deliver(request)).delivered).toBe(false);
  expect(
    await owner`SELECT id FROM in_app_notifications WHERE source_event_id = ${request.id}`,
  ).toHaveLength(0);
  expect(
    await owner`SELECT event_id FROM consumed_events WHERE event_id = ${request.id}`,
  ).toHaveLength(0);
  expect(
    (await h.events()).filter((e) => e.payload['source_event_id'] === request.id),
  ).toHaveLength(0);
  const recovered = {
    ...request,
    payload: {
      ...(request.payload as object),
      notification_recipients: [recipient(), recipient(OTHER_INBOX_USER)],
    },
  };
  expect(await h.deliver(recovered)).toEqual({ delivered: true });
  expect(
    await owner`SELECT id FROM in_app_notifications WHERE source_event_id = ${request.id}`,
  ).toHaveLength(2);
});

it('mixed-channel handling keeps WhatsApp authorization unchanged and makes no provider calls in consumer', async () => {
  const whatsapp = (await h.request()).payload as { notification_recipients: object[] };
  const request = await event([recipient(), ...whatsapp.notification_recipients]);
  expect(await h.deliver(request)).toEqual({ delivered: true });
  expect(
    await owner`SELECT id FROM in_app_notifications WHERE source_event_id = ${request.id}`,
  ).toHaveLength(1);
  const attempt = await h.attempt(request);
  expect((await h.read(attempt))?.['status']).toBe('PENDING');
  expect(h.channel.calls).toBe(0);
  await h.module.send.execute(request.companyId, attempt);
  expect(h.channel.calls).toBe(1);
});

it.each([
  { locale: null },
  { locale: 'fr' },
  { template_key: 'staff_otp' },
  { template_revision: 2 },
  { safe_parameters: [{ name: 'subject', type: 'text', value: 'https://example.test/private' }] },
])('refuses invalid or sensitive in-app payloads atomically: %j', async (change) => {
  const request = await event([{ ...recipient(), ...change }]);
  expect((await h.deliver(request)).delivered).toBe(false);
  expect(
    await owner`SELECT id FROM in_app_notifications WHERE source_event_id = ${request.id}`,
  ).toHaveLength(0);
});
