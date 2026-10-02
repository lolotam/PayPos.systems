import { randomInt } from 'node:crypto';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { pgUrl } from '../../../packages/db/test/pg-env.ts';
import { startHarness, type Harness } from './harness.ts';
import { origin, paired, phone } from './staff-otp-harness.ts';
import { builtSmoke } from './built-smoke.ts';

let h: Harness, device: Awaited<ReturnType<typeof paired>>;
beforeAll(async () => {
  h = await startHarness();
  const cookie = await h.signedInOperator('synthetic-smoke@otp.invalid');
  const company = await h.onboard(cookie, 'Synthetic smoke');
  const business = (
    await h.send('POST', '/v1/businesses', {
      cookie,
      company,
      key: 'smoke-business',
      body: { vertical_type: 'salon', name_en: 'Synthetic' },
    })
  ).body['id'] as string;
  const branch = (
    await h.send('POST', `/v1/businesses/${business}/branches`, {
      cookie,
      company,
      key: 'smoke-branch',
      body: { name_en: 'Synthetic' },
    })
  ).body['id'] as string;
  device = await paired(h, cookie, company, branch);
});
afterAll(async () => {
  await h?.close();
});

function environment(port: number, variant: 'empty' | 'intake-url-only'): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/^(STAFF_OTP_|WHATSAPP_)|NOTIFICATION/.test(name)) env[name] = '';
  }
  delete env['FORCE_COLOR'];
  const pg = inject('pg');
  return {
    ...env,
    NODE_ENV: 'production',
    DATABASE_URL: h.urls.app,
    AUTH_DATABASE_URL: h.urls.auth,
    DISPATCHER_DATABASE_URL: pgUrl(
      pg,
      'pospay_dispatcher',
      pg.dispatcherPassword,
      new URL(h.urls.owner).pathname.slice(1),
    ),
    BETTER_AUTH_SECRET: 'synthetic'.repeat(8),
    BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
    AUTH_TRUSTED_ORIGINS: origin,
    COOKIE_DOMAIN: '',
    API_PORT: String(port),
    WORKER_PORT: String(port),
    API_HOST: '127.0.0.1',
    WORKER_HOST: '127.0.0.1',
    LOG_LEVEL: 'info',
    TRUSTED_PROXY_CIDRS: '',
    PLATFORM_NOTIFICATIONS_DATABASE_URL:
      variant === 'empty'
        ? ''
        : pgUrl(
            pg,
            'pospay_notifications',
            pg.notificationsPassword,
            new URL(h.urls.owner).pathname.slice(1),
          ),
  };
}

it.each(['empty', 'intake-url-only'] as const)(
  'built production API and worker stay ready with %s optional settings',
  async (variant) => {
    const apiPort = randomInt(40000, 45000),
      workerPort = randomInt(45000, 50000);
    const before = await h.owner`SELECT count(*)::int AS count FROM auth_otp_challenges`;
    const connection = h.redis.duplicate({ keyPrefix: '' });
    connection.on('error', () => undefined);
    const queue = new Queue('notifications-otp', { connection });
    const jobsBefore = await queue.getJobCounts();
    process.stdout.write(`SMOKE scenario=${variant}\n`);
    try {
      await builtSmoke('api', environment(apiPort, variant), apiPort, async (base) => {
        const response = await fetch(`${base}/v1/devices/me/staff-otp/request`, {
          method: 'POST',
          headers: {
            authorization: `Device ${device.token}`,
            origin,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ phone, locale: 'ar' }),
          signal: AbortSignal.timeout(3000),
        });
        const body = await response.json();
        expect(response.status).toBe(503);
        expect(body).toMatchObject({ code: 'OTP_UNAVAILABLE' });
        process.stdout.write(`SMOKE API OTP request: ${response.status} ${JSON.stringify(body)}\n`);
      });
      await builtSmoke(
        'worker',
        environment(workerPort, variant),
        workerPort,
        async () => undefined,
      );
      expect(await queue.getJobCounts()).toEqual(jobsBefore);
    } finally {
      await queue.close();
      connection.disconnect();
    }
    expect(await h.owner`SELECT count(*)::int AS count FROM auth_otp_challenges`).toEqual(before);
    expect(
      (await h.owner`SELECT count(*)::int AS count FROM auth_notification_attempts`)[0]?.['count'],
    ).toBe(0);
    process.stdout.write('SMOKE OTP challenges=0 attempts=0 jobs-created=0\n');
  },
);
