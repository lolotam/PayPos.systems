import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { pgUrl } from '../../../../../../packages/db/test/pg-env.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';
import { builtSmoke } from '../../../../test/built-smoke.ts';

let h: Harness, cookie: string, company: string, business: string;
beforeAll(async () => {
  h = await startHarness();
  cookie = await h.signedInOperator('files-smoke@synthetic.invalid');
  company = await h.onboard(cookie, 'Synthetic smoke');
  business = (
    await h.send('POST', '/v1/businesses', {
      cookie,
      company,
      key: 'files-smoke-business',
      body: { vertical_type: 'salon', name_en: 'Synthetic' },
    })
  ).body['id'] as string;
});
afterAll(async () => {
  await h?.close();
});

function environment(port: number): NodeJS.ProcessEnv {
  const env = { ...process.env },
    pg = inject('pg');
  for (const name of Object.keys(env))
    if (
      /^(STORAGE_|STAFF_OTP_|WHATSAPP_|EMAIL_|RESEND_|NOTIFICATION_|PLATFORM_NOTIFICATIONS_)/.test(
        name,
      )
    )
      env[name] = '';
  delete env['FORCE_COLOR'];
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
    BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-hmac',
    BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
    AUTH_TRUSTED_ORIGINS: 'http://admin.test',
    COOKIE_DOMAIN: '',
    API_PORT: String(port),
    WORKER_PORT: String(port),
    API_HOST: '127.0.0.1',
    WORKER_HOST: '127.0.0.1',
    TRUSTED_PROXY_CIDRS: '',
    LOG_LEVEL: 'info',
    REDIS_URL: redisUrl(),
  };
}

// زي الـ harness: CI بيكتب REDIS_PASSWORD بس، فنبني العنوان منه لو REDIS_URL مش موجود.
function redisUrl(): string {
  const configured = process.env['REDIS_URL'];
  if (configured !== undefined && configured !== '') return configured;
  const password = encodeURIComponent(process.env['REDIS_PASSWORD'] ?? '');
  return `redis://:${password}@${process.env['REDIS_HOST'] ?? '127.0.0.1'}:${process.env['REDIS_PORT'] ?? '6379'}`;
}

it('built production API and worker are ready with empty optional settings; all files routes give a named unavailable error', async () => {
  const apiPort = randomInt(40000, 45000),
    workerPort = randomInt(45000, 50000);
  await builtSmoke('api', environment(apiPort), apiPort, async (base) => {
    const headers = { cookie, 'x-company-id': company, 'content-type': 'application/json' };
    const id = '01920000-0000-7000-8000-000000000abc';
    const cases = [
      ['GET', `/v1/files/${id}`],
      ['POST', '/v1/files/download'],
      ['POST', `/v1/files/${id}/confirm`],
      ['POST', `/v1/files/${id}/download`],
      ['POST', `/v1/businesses/${business}/files/uploads`],
    ] as const;
    for (const [method, path] of cases) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers,
        ...(method === 'POST' ? { body: '{}' } : {}),
        signal: AbortSignal.timeout(3000),
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' });
      process.stdout.write(`SMOKE files ${method}: 503 STORAGE_NOT_CONFIGURED\n`);
    }
  });
  await builtSmoke(
    'worker',
    { ...environment(workerPort), AUTH_DATABASE_URL: '' },
    workerPort,
    async () => undefined,
  );
}, 40000);
