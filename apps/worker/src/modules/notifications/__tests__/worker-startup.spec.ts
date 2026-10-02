import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { platformHarness } from './platform-harness.ts';
import { logger } from './harness.ts';
import {
  createInAppNotificationModule,
  createNotificationModule,
  readNotificationConfiguration,
} from '../notifications.module.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { createWorker } from '../../../worker.ts';

let h: Awaited<ReturnType<typeof platformHarness>>;

beforeAll(async () => {
  h = await platformHarness();
});

afterAll(async () => {
  await h?.close();
});

describe('production worker startup with empty notification settings', () => {
  it('builds worker modules at unit level without server when notification settings are empty', async () => {
    const inApp = createInAppNotificationModule({
      database: h.db,
      ids: systemUuidV7(),
      clock: h.clock,
    });
    const deliverer = createDeliverer(h.db, [inApp.consumer], logger, {
      knownEventTypes: inApp.eventTypes,
    });
    expect(deliverer).toBeDefined();

    const worker = await createWorker(
      {
        readiness: [{ name: 'database', check: () => h.db.ping() }],
        stopPolling: async () => undefined,
        release: async () => undefined,
      },
      logger,
    );

    try {
      const response = await worker.inject({ method: 'GET', url: '/ready' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'ready' });
    } finally {
      await worker.close();
    }
  });

  it('refuses live outbound notification module without PR 6 admission in production', () => {
    const config = readNotificationConfiguration({
      NODE_ENV: 'production',
      NOTIFICATIONS_MODE: 'live',
      NOTIFICATION_PHONE_HASH_KEY: 'test-secret'.repeat(4),
      NOTIFICATION_PHONE_HASH_KEY_ID: 'test-v1',
      WHATSAPP_ACCESS_TOKEN: 'test-secret',
      WHATSAPP_PHONE_NUMBER_ID: '10042',
    });
    expect(() =>
      createNotificationModule({
        database: h.db,
        ids: systemUuidV7(),
        clock: h.clock,
        configuration: config,
        production: true,
      }),
    ).toThrow('NOTIFICATIONS_LIVE_REQUIRES_PR6');
  });
});
