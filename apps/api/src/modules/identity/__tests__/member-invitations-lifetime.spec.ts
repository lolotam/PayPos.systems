import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

// عمر الرابط (AC-G1-2، IM-Q3/D9) على المسار الكامل: الساعة المحقونة بتتزحزح لورا، فالرابط
// بيتصدر بانتهاء = ساعة الحقن + 48 ساعة، وBetter Auth بيحكم عليه بالساعة الحقيقية عند الاستهلاك؛
// فالحد الحقيقي (48 ساعة) بيتعدّى بالظبط: قبله 5 دقايق بيشتغل وبعده دقيقة بيترفض.
const HOUR = 60 * 60 * 1000;
let offsetMs = 0;
let h: Harness;
const owner = { email: 'g1lt-owner@example.test', cookie: '' };
let company: string;

beforeAll(async () => {
  h = await startHarness({
    staffAccessRoutes: true,
    clock: { now: () => new Date(Date.now() + offsetMs) },
  });
  owner.cookie = await h.signedInOperator(owner.email);
  company = await h.onboard(owner.cookie, 'G1 Lifetime');
});

afterAll(async () => {
  await h?.close();
});

const invite = async (email: string, offset: number) => {
  offsetMs = offset;
  const response = await h.send('POST', '/v1/memberships/invitations', {
    cookie: owner.cookie,
    company,
    body: {
      email,
      name: 'Lifetime',
      role: 'accountant',
      scope: { type: 'COMPANY', id: company },
      email_confirmed: true,
    },
  });
  offsetMs = 0;
  expect(response.status).toBe(201);
  return response.body;
};
const tokenOf = (link: unknown) => new URL(String(link)).pathname.split('/').pop() ?? '';
const open = (link: unknown) => {
  const url = new URL(String(link));
  return h.app.inject({
    method: 'GET',
    url: url.pathname + url.search,
    headers: { origin: 'http://admin.test' },
  });
};
const reset = (token: string) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/auth/reset-password',
    headers: { origin: 'http://admin.test' },
    payload: { token, newPassword: 'lifetime-chosen-pass' },
  });

describe('AC-G1-2 — the link lives exactly 48 hours, once', () => {
  it('stores expiry = injected instant + 48 hours', async () => {
    const issued = await invite('lt-exact@example.test', -3 * HOUR);
    const [row] = await h.owner`
      SELECT (EXTRACT(epoch FROM expires_at) * 1000)::bigint AS expires
      FROM verification WHERE identifier = ${`reset-password:${tokenOf(issued['set_password_link'])}`}`;
    const expected = Date.now() - 3 * HOUR + 48 * HOUR;
    expect(Math.abs(Number(row?.['expires']) - expected)).toBeLessThan(60_000);
  });

  it('works 5 minutes before the 48-hour mark', async () => {
    const issued = await invite('lt-before@example.test', -(48 * HOUR - 5 * 60_000));
    expect((await open(issued['set_password_link'])).statusCode).toBe(302);
    expect(String((await open(issued['set_password_link'])).headers['location'])).not.toContain(
      'error=',
    );
    expect((await reset(tokenOf(issued['set_password_link']))).statusCode).toBe(200);
  });

  it('is refused 1 minute after the 48-hour mark, at the link and at the reset', async () => {
    const issued = await invite('lt-after@example.test', -(48 * HOUR + 60_000));
    expect(String((await open(issued['set_password_link'])).headers['location'])).toContain(
      'error=INVALID_TOKEN',
    );
    expect((await reset(tokenOf(issued['set_password_link']))).statusCode).toBe(400);
  });

  it('is dead after one use', async () => {
    const issued = await invite('lt-once@example.test', 0);
    expect((await reset(tokenOf(issued['set_password_link']))).statusCode).toBe(200);
    expect((await reset(tokenOf(issued['set_password_link']))).statusCode).toBe(400);
  });

  it('a re-issue at a later instant gives a fresh 48 hours and kills the expired link', async () => {
    const issued = await invite('lt-reissue@example.test', -(48 * HOUR + 60_000));
    const reissued = await h.send(
      'POST',
      `/v1/memberships/invitations/${issued['invitation_id']}/link`,
      { cookie: owner.cookie, company },
    );
    expect(reissued.status).toBe(200);
    expect((await reset(tokenOf(issued['set_password_link']))).statusCode).toBe(400);
    expect((await reset(tokenOf(reissued.body['set_password_link']))).statusCode).toBe(200);
  });
});
