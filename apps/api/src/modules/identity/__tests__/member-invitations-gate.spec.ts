import { errorEnvelope } from '@pospay/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

// بوابة التفعيل (AC-F1-7c، P2-b): والمسارات مقفولة بتجيب 503 NOT_READY قبل أي parsing أو حارس —
// حتى لطلب من غير جلسة، أو بجسم JSON باطل أو مخالف للمخطط — وما بيكتب حاجة. وبعد فتح البوابة
// نفس الطلب المشوّه بيجيب 400 عادي، فالـ 503 مش لأن المسار ناقص.
const ROUTES = [
  { method: 'POST', url: '/v1/memberships/invitations' },
  { method: 'GET', url: '/v1/memberships/invitations' },
  { method: 'POST', url: '/v1/memberships/invitations/01920000-0000-7000-8000-0000000000d1/link' },
] as const;
const BAD_BODIES = [
  { name: 'no body', payload: undefined },
  { name: 'broken JSON', payload: '{"email": "a@example.test"', raw: true },
  { name: 'wrong shape', payload: { email: 42, role: 'owner' } },
] as const;
const COOKIE_OWNER = { email: 'g1-gate-owner@example.test', cookie: '' };
let closed: Harness;
let open: Harness;

beforeAll(async () => {
  closed = await startHarness({});
  open = await startHarness({ staffAccessRoutes: true });
  COOKIE_OWNER.cookie = await closed.signedInOperator(COOKIE_OWNER.email);
});

afterAll(async () => {
  await Promise.all([closed?.close(), open?.close()]);
});

const call = (
  h: Harness,
  route: (typeof ROUTES)[number],
  bad: (typeof BAD_BODIES)[number],
  cookie?: string,
) =>
  h.app.inject({
    method: route.method,
    url: route.url,
    headers: {
      origin: 'http://admin.test',
      ...(cookie === undefined ? {} : { cookie }),
      ...(route.method === 'POST' && bad.payload !== undefined
        ? { 'content-type': 'application/json' }
        : {}),
    },
    ...(route.method === 'POST' && bad.payload !== undefined
      ? { payload: 'raw' in bad ? bad.payload : JSON.stringify(bad.payload) }
      : {}),
  });

describe('the activation gate is off', () => {
  for (const route of ROUTES) {
    for (const bad of BAD_BODIES) {
      it(`${route.method} ${route.url.replace(/[0-9a-f-]{36}/, ':id')} answers 503 NOT_READY for ${bad.name}, signed in or not`, async () => {
        for (const cookie of [undefined, COOKIE_OWNER.cookie]) {
          const response = await call(closed, route, bad, cookie);
          expect(response.statusCode).toBe(503);
          expect(errorEnvelope.parse(response.json()).code).toBe('NOT_READY');
        }
      });
    }
  }

  it('wrote nothing', async () => {
    expect(await closed.owner`SELECT count(*)::int AS n FROM member_invitations`).toEqual([
      { n: 0 },
    ]);
  });
});

describe('the same malformed requests with the gate on are ordinary refusals', () => {
  it('answers 401 without a session, a plain 4xx for a broken body, and 400 for a wrong shape', async () => {
    expect((await call(open, ROUTES[0], BAD_BODIES[0])).statusCode).toBe(401);
    const cookie = await open.signedInOperator('g1-gate-open@example.test');
    const brokenJson = await call(open, ROUTES[0], BAD_BODIES[1], cookie);
    expect(brokenJson.statusCode).toBeGreaterThanOrEqual(400);
    expect(brokenJson.statusCode).not.toBe(503);
    const company = await open.onboard(cookie, 'G1 Gate Open');
    const broken = await open.send('POST', '/v1/memberships/invitations', {
      cookie,
      company,
      body: { email: 42, role: 'owner' },
    });
    expect(broken.status).toBe(400);
  });
});
