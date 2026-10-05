import { afterAll, beforeAll, expect, it } from 'vitest';
import { readNotificationConfiguration } from '@pospay/notifications';
import { systemUuidV7 } from '@pospay/ids';
import {
  createInAppNotificationModule,
  createNotificationModule,
} from '../notifications.module.ts';
import { platformHarness } from './platform-harness.ts';
import { seedInboxUsers } from '../../../../../../packages/db/test/in-app-fixtures.ts';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createEmailModule } from '../email.module.ts';
import { FakeChannel, type EmailRequest } from '@pospay/notifications';

it('production email factory cannot accept an injected sending channel', () => {
  expect(() =>
    createEmailModule({
      production: true,
      ids: systemUuidV7(),
      clock: { now: () => new Date() },
      testing: { channel: new FakeChannel<EmailRequest>(() => new Date()) },
    }),
  ).toThrow('EMAIL_TEST_CHANNEL_IN_PRODUCTION');
});

let h: Awaited<ReturnType<typeof platformHarness>>;
beforeAll(async () => {
  h = await platformHarness();
  await seedInboxUsers(h.owner);
});
afterAll(async () => {
  await h?.close();
});

it('live configuration validates credentials/version but live dispatch still requires PR 6 admission', () => {
  const env = {
    NODE_ENV: 'production',
    NOTIFICATIONS_MODE: 'live',
    NOTIFICATION_PHONE_HASH_KEY: 'test-secret'.repeat(4),
    NOTIFICATION_PHONE_HASH_KEY_ID: 'test-v1',
    WHATSAPP_ACCESS_TOKEN: 'test-secret',
    WHATSAPP_PHONE_NUMBER_ID: '10042',
  };
  const configuration = readNotificationConfiguration(env);
  expect(configuration.mode).toBe('live');
  expect(() => readNotificationConfiguration({ ...env, WHATSAPP_ACCESS_TOKEN: '' })).toThrow(
    'NOTIFICATION_PROVIDER_CONFIG_INVALID',
  );
  expect(() =>
    readNotificationConfiguration({ ...env, WHATSAPP_GRAPH_API_VERSION: 'v22.0' }),
  ).toThrow('NOTIFICATION_GRAPH_VERSION_INVALID');
  expect(() =>
    createNotificationModule({
      database: h.db,
      ids: systemUuidV7(),
      clock: h.clock,
      configuration,
      production: true,
    }),
  ).toThrow('NOTIFICATIONS_LIVE_REQUIRES_PR6');
  expect(() =>
    createNotificationModule({
      database: h.db,
      ids: systemUuidV7(),
      clock: h.clock,
      configuration,
      production: false,
    }),
  ).toThrow('NOTIFICATIONS_LIVE_REQUIRES_PR6');
});

it('production in-app processing needs no WhatsApp secrets and refuses outbound atomically', async () => {
  const module = createInAppNotificationModule({
    database: h.db,
    ids: systemUuidV7(),
    clock: h.clock,
  });
  const source = await h.request();
  const input = {
    ...source,
    payload: {
      notification_recipients: [
        {
          channel: 'IN_APP',
          user_id: USER,
          locale: 'ar',
          template_key: 'generic_notice',
          template_revision: 1,
          safe_parameters: [{ name: 'subject', type: 'text', value: 'Synthetic subject' }],
        },
      ],
    },
  };
  await h.db.withTenant(source.companyId, (tx) => module.consumer.handle(tx, input));
  expect(
    await h.owner`SELECT id FROM in_app_notifications WHERE source_event_id=${source.id}`,
  ).toHaveLength(1);
  const blocked = await h.request();
  await expect(
    h.db.withTenant(blocked.companyId, (tx) => module.consumer.handle(tx, blocked)),
  ).rejects.toThrow('NOTIFICATIONS_LIVE_REQUIRES_PR6');
  expect(
    await h.owner`SELECT id FROM notification_attempts WHERE source_event_id=${blocked.id}`,
  ).toHaveLength(0);
  expect(h.channel.calls).toBe(0);
});
