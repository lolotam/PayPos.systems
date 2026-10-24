import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { errorEnvelope, signOutResult } from '@pospay/contracts';
import { testRedis } from '../../../../test/harness.ts';
import { personalFixture, personalOrigin } from '../../../../test/personal-staff.fixture.ts';

let f: Awaited<ReturnType<typeof personalFixture>>;
let redis: ReturnType<typeof testRedis>;
const statuses: number[] = [];

const signOut = (headers: Record<string, string> = {}) =>
  f.app.inject({
    method: 'POST',
    url: '/v1/staff/personal-session/sign-out',
    headers: { origin: personalOrigin, ...headers },
  });
const resolves = (cookie: string) =>
  f.app.inject({
    method: 'GET',
    url: '/v1/staff/personal-session',
    headers: { origin: personalOrigin, cookie },
  });
const issueSession = async () =>
  (
    await f.auth.personal.issue(
      f.userId,
      { purpose: 'STAFF_PERSONAL', companyId: f.companyId, businessId: f.businessId },
      async () => true,
    )
  ).cookie;
const sessionRows = async (id: string) => f.owner`SELECT id FROM session WHERE id=${id}`;
// The request carries the cookie pair; the Set-Cookie header carries its attributes.
const requestCookie = (cookie: string) => cookie.split(';')[0] ?? '';

beforeAll(async () => {
  redis = testRedis();
  f = await personalFixture(redis);
});
afterAll(async () => {
  await f?.close();
  await redis?.quit();
});
// The limiter counts per IP and route, so every case starts from an empty window.
beforeEach(async () => {
  await redis.del('rate:sign-out:personal:127.0.0.1');
});

it('SO-01 a live personal session ends, its cookie is cleared and the read stops resolving', async () => {
  const cookie = requestCookie(await issueSession());
  expect((await resolves(cookie)).statusCode).toBe(200);
  const response = await signOut({ cookie });
  statuses.push(response.statusCode);
  expect(response.statusCode).toBe(200);
  expect(signOutResult.parse(response.json())).toEqual({ status: 'SIGNED_OUT' });
  expect(String(response.headers['set-cookie'])).toContain('pospay-personal.session_token=');
  expect(String(response.headers['set-cookie'])).toContain('Expires=Thu, 01 Jan 1970');
  expect((await resolves(cookie)).statusCode).toBe(401);
});

it('SO-02 a repeat sign-out answers no session', async () => {
  const cookie = requestCookie(await issueSession());
  await signOut({ cookie });
  const again = await signOut({ cookie });
  statuses.push(again.statusCode);
  expect(again.statusCode).toBe(200);
  expect(signOutResult.parse(again.json())).toEqual({ status: 'NO_SESSION' });
});

it('SO-03 a sign-out without a cookie clears nothing, and a replaced one still clears its cookie', async () => {
  const without = await signOut();
  statuses.push(without.statusCode);
  expect(without.statusCode).toBe(200);
  expect(signOutResult.parse(without.json())).toEqual({ status: 'NO_SESSION' });
  expect(without.headers['set-cookie']).toBeUndefined();
  const replaced = requestCookie(await issueSession());
  await issueSession();
  const response = await signOut({ cookie: replaced });
  statuses.push(response.statusCode);
  expect(response.statusCode).toBe(200);
  expect(signOutResult.parse(response.json())).toEqual({ status: 'NO_SESSION' });
  expect(String(response.headers['set-cookie'])).toContain('pospay-personal.session_token=');
});

it('SO-04 a user who lost eligibility still ends her session and the row is gone', async () => {
  const cookie = requestCookie(await issueSession());
  const sessionId = (
    await f.owner`SELECT id FROM session WHERE user_id=${f.userId} AND purpose='STAFF_PERSONAL'`
  )[0]?.['id'] as string;
  await f.owner`UPDATE memberships SET ends_at=now() WHERE company_id=${f.companyId} AND id=${f.membershipId}`;
  try {
    const response = await signOut({ cookie });
    statuses.push(response.statusCode);
    expect(response.statusCode).toBe(200);
    expect(signOutResult.parse(response.json())).toEqual({ status: 'SIGNED_OUT' });
  } finally {
    await f.owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.companyId} AND id=${f.membershipId}`;
  }
  expect(await sessionRows(sessionId)).toEqual([]);
});

it('SO-09 a missing or wrong origin is refused and the session survives', async () => {
  const cookie = requestCookie(await issueSession());
  const missing = await f.app.inject({
    method: 'POST',
    url: '/v1/staff/personal-session/sign-out',
    headers: { cookie },
  });
  const wrong = await signOut({ cookie, origin: 'https://other.synthetic.invalid' });
  statuses.push(missing.statusCode, wrong.statusCode);
  expect([missing.statusCode, wrong.statusCode]).toEqual([403, 403]);
  expect(errorEnvelope.parse(missing.json()).code).toBe('FORBIDDEN');
  expect(errorEnvelope.parse(wrong.json()).code).toBe('FORBIDDEN');
  expect(missing.headers['set-cookie']).toBeUndefined();
  expect(wrong.headers['set-cookie']).toBeUndefined();
  expect((await resolves(cookie)).statusCode).toBe(200);
});

it('SO-10 an authorization header is refused and the session survives', async () => {
  const cookie = requestCookie(await issueSession());
  const response = await signOut({ cookie, authorization: 'Device revoked' });
  statuses.push(response.statusCode);
  expect(response.statusCode).toBe(403);
  expect(errorEnvelope.parse(response.json()).code).toBe('FORBIDDEN');
  expect(response.headers['set-cookie']).toBeUndefined();
  expect((await resolves(cookie)).statusCode).toBe(200);
});

it('SO-11 a staff cookie sent to the personal route ends nothing', async () => {
  const staff = await f.auth.staff.issue(
    f.userId,
    {
      companyId: f.companyId,
      businessId: f.businessId,
      branchId: f.branchId,
      deviceId: f.ids.newId(),
    },
    async () => true,
  );
  const response = await signOut({ cookie: requestCookie(staff.cookie) });
  statuses.push(response.statusCode);
  expect(response.statusCode).toBe(200);
  expect(signOutResult.parse(response.json())).toEqual({ status: 'NO_SESSION' });
  expect(response.headers['set-cookie']).toBeUndefined();
  expect(await sessionRows(staff.session.sessionId)).toHaveLength(1);
});

it('SO-12 two concurrent sign-outs end the session once', async () => {
  const cookie = requestCookie(await issueSession());
  const [first, second] = await Promise.all([signOut({ cookie }), signOut({ cookie })]);
  statuses.push(first.statusCode, second.statusCode);
  expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
  const answers = [first, second]
    .map((response) => signOutResult.parse(response.json()).status)
    .sort();
  expect(answers).toEqual(['NO_SESSION', 'SIGNED_OUT']);
});

it('SO-14 the thirty-first sign-out in a minute is refused and nothing changes', async () => {
  for (let index = 0; index < 30; index += 1) expect((await signOut()).statusCode).toBe(200);
  const cookie = requestCookie(await issueSession());
  const refused = await signOut({ cookie });
  statuses.push(refused.statusCode);
  expect(refused.statusCode).toBe(429);
  expect(errorEnvelope.parse(refused.json()).code).toBe('TOO_MANY_REQUESTS');
  expect(refused.headers['set-cookie']).toBeUndefined();
  expect((await resolves(cookie)).statusCode).toBe(200);
});

it('SO-16 no sign-out answer in this file was ever a 401', () => {
  expect(statuses.filter((status) => status === 401)).toEqual([]);
});
