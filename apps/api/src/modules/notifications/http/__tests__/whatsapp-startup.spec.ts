import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../../app.ts';
import { readConfig } from '../../../../shared/config.ts';

describe('production API startup with empty notification settings', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    const config = readConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://pospay_app:s3cret-pass@127.0.0.1:5432/pospay',
      REDIS_URL: 'redis://:r3dis-pass@127.0.0.1:6379',
      AUTH_DATABASE_URL: 'postgres://pospay_auth:auth-pass@127.0.0.1:5432/pospay',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      BETTER_AUTH_URL: 'http://127.0.0.1:3000',
      PLATFORM_NOTIFICATIONS_DATABASE_URL: '',
      WHATSAPP_APP_SECRET: '',
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: '',
    });
    expect(config.PLATFORM_NOTIFICATIONS_DATABASE_URL).toBeUndefined();

    app = await createApp({
      readiness: [],
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /v1/webhooks/whatsapp answers 503 NOT_READY', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-secret&hub.challenge=12345',
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'NOT_READY' });
  });

  it('POST /v1/webhooks/whatsapp answers 503 NOT_READY', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/whatsapp',
      payload: JSON.stringify({ object: 'whatsapp_business_account' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'NOT_READY' });
  });
});
