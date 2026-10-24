import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { errorEnvelope, signOutResult } from '@pospay/contracts';
import { origin, paired, phone, staffHarness } from '../../../../test/staff-otp-harness.ts';

let f: Awaited<ReturnType<typeof staffHarness>>,
  owner: string,
  company: string,
  business: string,
  branch: string,
  userId: string;
let device: Awaited<ReturnType<typeof paired>>;
const statuses: number[] = [];

const signOut = (headers: Record<string, string> = {}) =>
  f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/me/staff-session/sign-out',
    headers: { origin, ...headers },
  });
const resolves = (cookie: string) =>
  f.h.app.inject({
    method: 'GET',
    url: '/v1/devices/me/staff-session',
    headers: { authorization: `Device ${device.token}`, origin, cookie },
  });
const issueSession = async (deviceId: string) =>
  (
    await f.h.auth.staff.issue(
      userId,
      { companyId: company, businessId: business, branchId: branch, deviceId },
      async () => true,
    )
  ).cookie;
// The request carries the cookie pair; the Set-Cookie header carries its attributes.
const requestCookie = (cookie: string) => cookie.split(';')[0] ?? '';
const revoke = async (deviceId: string) =>
  f.h.send('POST', `/v1/branches/${branch}/devices/${deviceId}/revoke`, {
    cookie: owner,
    company,
  });
// The two answers must be the same request, not the same moment: the request id and the date are per response.
const stableHeaders = (headers: Record<string, unknown>) => {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers))
    if (key !== 'x-request-id' && key !== 'date') kept[key] = value;
  return kept;
};

beforeAll(async () => {
  f = await staffHarness();
  owner = await f.h.signedInOperator('synthetic-owner@signout.invalid');
  company = await f.h.onboard(owner, 'Sign-out Co');
  business = (
    await f.h.send('POST', '/v1/businesses', {
      cookie: owner,
      company,
      key: 'signout-business',
      body: { vertical_type: 'salon', name_en: 'Synthetic salon' },
    })
  ).body['id'] as string;
  branch = (
    await f.h.send('POST', `/v1/businesses/${business}/branches`, {
      cookie: owner,
      company,
      key: 'signout-branch',
      body: { name_en: 'Synthetic branch' },
    })
  ).body['id'] as string;
  device = await paired(f.h, owner, company, branch);
  userId = await f.h.auth.provisionUser({
    email: 'synthetic-signout@otp.invalid',
    name: 'Synthetic sign-out',
    password: 'synthetic'.repeat(8),
  });
  await f.h.owner`UPDATE "user" SET phone_number=${phone} WHERE id=${userId}`;
  await f.h.owner`UPDATE "user" SET phone_binding_approved_at=clock_timestamp() WHERE id=${userId}`;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,scope_type,scope_id,role_id,role_owner_key,starts_at)
      SELECT ${company},${randomUUID()},${userId},'BRANCH',${branch},id,'global',now()-interval '1 day'
      FROM roles WHERE code='staff' AND company_id IS NULL`;
});
afterAll(async () => {
  await f?.close();
});
// The limiter counts per IP and route, so every case starts from an empty window.
beforeEach(async () => {
  await f.h.redis.del('rate:sign-out:staff:127.0.0.1');
});

it('SO-05 a live staff session ends, its cookie is cleared and the device stays paired', async () => {
  const cookie = requestCookie(await issueSession(device.id));
  expect((await resolves(cookie)).statusCode).toBe(200);
  const response = await signOut({ cookie });
  statuses.push(response.statusCode);
  expect(response.statusCode).toBe(200);
  expect(signOutResult.parse(response.json())).toEqual({ status: 'SIGNED_OUT' });
  expect(String(response.headers['set-cookie'])).toContain('pospay-staff.session_token=');
  expect(String(response.headers['set-cookie'])).toContain('Expires=Thu, 01 Jan 1970');
  expect((await resolves(cookie)).statusCode).toBe(401);
  const [row] = await f.h
    .owner`SELECT status FROM devices WHERE company_id=${company} AND id=${device.id}`;
  expect(row?.['status']).toBe('ACTIVE');
});

it('SO-02 a repeat sign-out answers no session', async () => {
  const cookie = requestCookie(await issueSession(device.id));
  await signOut({ cookie });
  const again = await signOut({ cookie });
  statuses.push(again.statusCode);
  expect(again.statusCode).toBe(200);
  expect(signOutResult.parse(again.json())).toEqual({ status: 'NO_SESSION' });
});

it('SO-06 a revoked device still ends its session with its cookie', async () => {
  const own = await paired(f.h, owner, company, branch);
  const cookie = requestCookie(await issueSession(own.id));
  expect((await revoke(own.id)).status).toBe(204);
  const response = await signOut({ cookie, authorization: `Device ${own.token}` });
  statuses.push(response.statusCode);
  expect(response.statusCode).toBe(200);
  expect(signOutResult.parse(response.json())).toEqual({ status: 'SIGNED_OUT' });
  expect(
    await f.h
      .owner`SELECT id FROM session WHERE purpose='STAFF_POS' AND staff_device_context->>'deviceId'=${own.id}`,
  ).toEqual([]);
});

it('SO-07 a revoked and an active device answer a cookieless sign-out identically', async () => {
  const own = await paired(f.h, owner, company, branch);
  expect((await revoke(own.id)).status).toBe(204);
  const revoked = await signOut({ authorization: `Device ${own.token}` });
  const active = await signOut({ authorization: `Device ${device.token}` });
  statuses.push(revoked.statusCode, active.statusCode);
  expect([revoked.statusCode, active.statusCode]).toEqual([200, 200]);
  expect(signOutResult.parse(revoked.json())).toEqual({ status: 'NO_SESSION' });
  expect(signOutResult.parse(active.json())).toEqual({ status: 'NO_SESSION' });
  expect(revoked.headers['set-cookie']).toBeUndefined();
  expect(active.headers['set-cookie']).toBeUndefined();
  expect(stableHeaders(revoked.headers)).toEqual(stableHeaders(active.headers));
});

it('SO-08 a cookie for one device ends with another device token or with none', async () => {
  const own = await paired(f.h, owner, company, branch);
  const cookie = requestCookie(await issueSession(own.id));
  const withOther = await signOut({ cookie, authorization: `Device ${device.token}` });
  statuses.push(withOther.statusCode);
  expect(withOther.statusCode).toBe(200);
  expect(signOutResult.parse(withOther.json())).toEqual({ status: 'SIGNED_OUT' });
  const second = requestCookie(await issueSession(own.id));
  const without = await signOut({ cookie: second });
  statuses.push(without.statusCode);
  expect(without.statusCode).toBe(200);
  expect(signOutResult.parse(without.json())).toEqual({ status: 'SIGNED_OUT' });
});

it('SO-09 a missing or wrong origin is refused and the session survives', async () => {
  const cookie = requestCookie(await issueSession(device.id));
  const missing = await f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/me/staff-session/sign-out',
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

it('SO-11 a personal cookie sent to the staff route ends nothing', async () => {
  const personal = await f.h.auth.personal.issue(
    userId,
    { purpose: 'STAFF_PERSONAL', companyId: company, businessId: business },
    async () => true,
  );
  const response = await signOut({ cookie: requestCookie(personal.cookie) });
  statuses.push(response.statusCode);
  expect(response.statusCode).toBe(200);
  expect(signOutResult.parse(response.json())).toEqual({ status: 'NO_SESSION' });
  expect(response.headers['set-cookie']).toBeUndefined();
  expect(
    await f.h.owner`SELECT id FROM session WHERE id=${personal.session.sessionId}`,
  ).toHaveLength(1);
});

it('SO-12 two concurrent sign-outs end the session once', async () => {
  const cookie = requestCookie(await issueSession(device.id));
  const [first, second] = await Promise.all([signOut({ cookie }), signOut({ cookie })]);
  statuses.push(first.statusCode, second.statusCode);
  expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
  const answers = [first, second]
    .map((response) => signOutResult.parse(response.json()).status)
    .sort();
  expect(answers).toEqual(['NO_SESSION', 'SIGNED_OUT']);
});

it('SO-13d the sign-out answers signed out and its clearing cookie names the new cookie (D-6)', async () => {
  const cookie = requestCookie(await issueSession(device.id));
  const response = await signOut({ cookie });
  statuses.push(response.statusCode);
  expect(response.statusCode).toBe(200);
  expect(signOutResult.parse(response.json())).toEqual({ status: 'SIGNED_OUT' });
  const issued = await issueSession(device.id);
  expect((await resolves(requestCookie(issued))).statusCode).toBe(200);
  const clearing = String(response.headers['set-cookie']);
  expect(clearing).toContain('pospay-staff.session_token=');
  expect(clearing).toContain('Path=/v1');
  expect(issued).toContain('pospay-staff.session_token=');
  expect(issued).toContain('Path=/v1');
});

it('SO-13e a replacement session leaves the old cookie with nothing to end', async () => {
  const cookie = requestCookie(await issueSession(device.id));
  const replacement = requestCookie(await issueSession(device.id));
  const response = await signOut({ cookie });
  statuses.push(response.statusCode);
  expect(response.statusCode).toBe(200);
  expect(signOutResult.parse(response.json())).toEqual({ status: 'NO_SESSION' });
  expect((await resolves(replacement)).statusCode).toBe(200);
});

it('SO-13b a sign-out without a cookie answers no session and clears nothing', async () => {
  const response = await signOut();
  statuses.push(response.statusCode);
  expect(response.statusCode).toBe(200);
  expect(signOutResult.parse(response.json())).toEqual({ status: 'NO_SESSION' });
  expect(response.headers['set-cookie']).toBeUndefined();
});

it('SO-14 the thirty-first sign-out in a minute is refused and nothing changes', async () => {
  for (let index = 0; index < 30; index += 1) expect((await signOut()).statusCode).toBe(200);
  const cookie = requestCookie(await issueSession(device.id));
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
