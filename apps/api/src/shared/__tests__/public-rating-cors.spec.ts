import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createLogger } from '@pospay/observability';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../../app.ts';

const PAGE = 'https://rating.example.test';
const ADMIN = 'https://admin.example.test';
let app: NestFastifyApplication;
let disabled: NestFastifyApplication;

beforeAll(async () => {
  app = await createApp(
    {
      readiness: [],
      corsOrigins: [ADMIN],
      ratingPageOrigin: PAGE,
    },
    { logger: createLogger('silent') },
  );
  disabled = await createApp(
    {
      readiness: [],
      corsOrigins: [ADMIN],
    },
    { logger: createLogger('silent') },
  );
});
afterAll(async () => {
  await app.close();
  await disabled.close();
});

const routes = [
  ['view', 'GET'],
  ['submit', 'POST'],
  ['opt-out', 'POST'],
] as const;

it.each(routes)(
  'allows only the page origin for %s preflight, without credentials',
  async (route, method) => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/ratings/' + route,
      headers: {
        origin: PAGE,
        'access-control-request-method': method,
        'access-control-request-headers': 'x-rating-token,content-type',
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(PAGE);
    expect(response.headers['access-control-allow-methods']).toBe(method + ', OPTIONS');
    expect(response.headers['access-control-allow-headers']).toBe('content-type, x-rating-token');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
  },
);

it.each([ADMIN, 'https://other.example.test', 'null', PAGE + '.evil.test'])(
  'refuses another origin, including a login-trusted origin: %s',
  async (origin) => {
    for (const [route, method] of routes) {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/v1/ratings/' + route,
        headers: { origin, 'access-control-request-method': method },
      });
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    }
  },
);

it.each(routes)(
  'keeps %s actual error responses credential-free and generic',
  async (route, method) => {
    const response = await app.inject({
      method,
      url: '/v1/ratings/' + route,
      headers: { origin: PAGE },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('NOT_READY');
    expect(response.headers['access-control-allow-origin']).toBe(PAGE);
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.json()).not.toHaveProperty('business_name');
  },
);

it('keeps public CORS disabled when its origin is unset', async () => {
  const response = await disabled.inject({
    method: 'OPTIONS',
    url: '/v1/ratings/view',
    headers: { origin: PAGE, 'access-control-request-method': 'GET' },
  });
  expect(response.headers['access-control-allow-origin']).toBeUndefined();
  expect(response.headers['access-control-allow-credentials']).toBeUndefined();
});

it.each(['/v1/auth/sign-in/email', '/v1/businesses', '/v1/ratings/other'])(
  'preserves authenticated CORS and never trusts the page on %s',
  async (url) => {
    const response = await app.inject({
      method: 'OPTIONS',
      url,
      headers: { origin: ADMIN, 'access-control-request-method': 'POST' },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(ADMIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-headers']).not.toContain('x-rating-token');
    const publicAttempt = await app.inject({
      method: 'OPTIONS',
      url,
      headers: { origin: PAGE, 'access-control-request-method': 'POST' },
    });
    expect(publicAttempt.headers['access-control-allow-origin']).toBeUndefined();
  },
);
