import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

// عمر الرابط (AC-G1-2، IM-Q3/D9): 48 ساعة بتنزل بالظبط من الساعة المحقونة على المسار
// الكامل (نداء → use case → verification)، والاستهلاك مرة واحدة، والرابط المنتهي مرفوض.
let now = new Date('2026-11-24T08:00:00.000Z');
let h: Harness;
const owner = { email: 'g1lt-owner@example.test', cookie: '', userId: '' };
let company: string;

beforeAll(async () => {
  h = await startHarness({ staffAccessRoutes: true, clock: { now: () => now } });
  owner.cookie = await h.signedInOperator(owner.email);
  const [row] = await h.owner`SELECT id FROM "user" WHERE email = ${owner.email}`;
  owner.userId = (row?.['id'] as string) ?? '';
  company = await h.onboard(owner.cookie, 'G1 Lifetime');
});

afterAll(async () => {
  await h?.close();
});

const invite = (email: string) =>
  h.send('POST', '/v1/memberships/invitations', {
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

const tokenOf = (link: string) => new URL(link).pathname.split('/').pop() ?? '';

const resetPassword = (token: string, newPassword: string) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/auth/reset-password',
    headers: { origin: 'http://admin.test' },
    payload: { token, newPassword },
  });

describe('AC-G1-2 — the link lives exactly 48 hours, once', () => {
  it('the issued link expires exactly 48 hours after the injected clock on the full path', async () => {
    const issued = await invite('lt48@example.test');
    expect(issued.status).toBe(201);
    const token = tokenOf(issued.body['set_password_link'] as string);
    const [row] = await h.owner`
      SELECT EXTRACT(epoch FROM (expires_at - created_at))::int AS seconds,
             EXTRACT(epoch FROM (created_at - ${now.toISOString()}::timestamptz))::int AS drift
      FROM verification WHERE identifier = ${`reset-password:${token}`}`;
    expect(row?.['drift']).toBe(0);
    expect(row?.['seconds']).toBe(48 * 60 * 60);
  });

  it('a consumed link is dead, and a link past 48 hours is refused at consumption', async () => {
    const first = await invite('lt-once@example.test');
    const firstToken = tokenOf(first.body['set_password_link'] as string);
    expect((await resetPassword(firstToken, 'lt-once-pass')).statusCode).toBe(200);
    expect((await resetPassword(firstToken, 'lt-once-pass-2')).statusCode).toBe(400);
    const second = await invite('lt-expired@example.test');
    const expiredToken = tokenOf(second.body['set_password_link'] as string);
    // الرابط المنتهي بيرفض عند الاستهلاك (استهلاك Better Auth بيقرأ expires_at الحقيقي).
    await h.owner`
      UPDATE verification SET expires_at = now() - interval '1 second'
      WHERE identifier = ${`reset-password:${expiredToken}`}`;
    expect((await resetPassword(expiredToken, 'lt-expired-pass')).statusCode).toBe(400);
  });

  it('a re-issue advanced by the injected clock stamps 48 hours from the new instant', async () => {
    const issued = await invite('lt-reissue@example.test');
    const invitationId = issued.body['invitation_id'] as string;
    now = new Date(now.getTime() + 25 * 60 * 60 * 1000);
    const reissued = await h.send(
      'POST',
      `/v1/memberships/invitations/${invitationId}/link`,
      { cookie: owner.cookie, company },
    );
    expect(reissued.status).toBe(200);
    const newToken = tokenOf(reissued.body['set_password_link'] as string);
    const [row] = await h.owner`
      SELECT EXTRACT(epoch FROM (expires_at - created_at))::int AS seconds
      FROM verification WHERE identifier = ${`reset-password:${newToken}`}`;
    expect(row?.['seconds']).toBe(48 * 60 * 60);
    // والرابط القديم (قبل الساعة الجديدة) انبطل بالإصدار الجديد.
    const oldToken = tokenOf(issued.body['set_password_link'] as string);
    expect((await resetPassword(oldToken, 'lt-old-pass')).statusCode).toBe(400);
  });
});
