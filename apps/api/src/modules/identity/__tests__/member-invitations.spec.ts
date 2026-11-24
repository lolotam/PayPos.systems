import { errorEnvelope } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

// دعوة عضو (076 G1) عبر المسارات الحقيقية: مالك الشركة بس، والرابط مرة واحدة، والعمر 48 ساعة
// (IM-Q3). كل اختبار مُشمول على AC من spec §4 G1 بالاسم. إيميل له حساب موجود بيرفض (N1).
let h: Harness;
const chunks: Buffer[] = [];
const ownerA = { email: 'g1-owner-a@example.test', cookie: '', userId: '' };
const ownerB = { email: 'g1-owner-b@example.test', cookie: '', userId: '' };

const role = (code: string) => SYSTEM_ROLES.find((r) => r.code === code)?.id ?? '';

beforeAll(async () => {
  h = await startHarness({
    staffAccessRoutes: true,
    logs: new Writable({ write: captureChunk }),
  });
  for (const who of [ownerA, ownerB]) {
    who.cookie = await h.signedInOperator(who.email);
    who.userId = await userIdByEmail(who.email);
  }
});

afterAll(async () => {
  await h?.close();
});

function captureChunk(chunk: unknown, _encoding: string, callback: () => void): void {
  chunks.push(chunk as Buffer);
  callback();
}

async function userIdByEmail(email: string): Promise<string> {
  const [row] = await h.owner`SELECT id FROM "user" WHERE email = ${email}`;
  return (row?.['id'] as string) ?? '';
}

const invite = (cookie: string, company: string, body: object) =>
  h.send('POST', '/v1/memberships/invitations', { cookie, company, body });

const accountantBody = (company: string, email: string) => ({
  email,
  name: 'Ahmed',
  role: 'accountant',
  scope: { type: 'COMPANY', id: company },
  email_confirmed: true,
});

const tokenOf = (link: string) => new URL(link).pathname.split('/').pop() ?? '';

const resetPassword = (token: string, newPassword: string) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/auth/reset-password',
    headers: { origin: 'http://admin.test' },
    payload: { token, newPassword },
  });

describe('AC-G1-1 — inviting an accountant creates the user, the membership and a one-time link', () => {
  it('answers 201 once with a working link, then never returns it again', async () => {
    const companyA = await h.onboard(ownerA.cookie, 'G1 Company A1');
    const response = await invite(ownerA.cookie, companyA, accountantBody(companyA, 'ahmed@example.test'));
    expect(response.status).toBe(201);
    const link = response.body['set_password_link'] as string;
    const invitationId = response.body['invitation_id'] as string;
    // فتح الرابط الحقيقي (صفحة PR #1252) بيرد 200 قبل الاستهلاك، والاستهلاك POST /reset-password.
    expect(
      (
        await h.app.inject({
          method: 'GET',
          url: new URL(link).pathname + new URL(link).search,
          headers: { origin: 'http://admin.test' },
        })
      ).statusCode,
    ).toBe(200);
    expect((await resetPassword(tokenOf(link), 'ahmed-chosen-pass')).statusCode).toBe(200);
    const [membership] = await h.owner`
      SELECT role_id, role_owner_key, scope_type, scope_id, user_id FROM memberships
      WHERE company_id = ${companyA} AND user_id <> ${ownerA.userId}`;
    expect(membership).toMatchObject({
      role_id: role('accountant'),
      role_owner_key: 'global',
      scope_type: 'COMPANY',
      scope_id: companyA,
    });
    const [invitedUser] = await h.owner`
      SELECT invited_by_company_id, invitation_operation_id FROM "user" WHERE id = ${membership?.['user_id']}`;
    expect(invitedUser).toMatchObject({
      invited_by_company_id: companyA,
      invitation_operation_id: invitationId,
    });
    const list = await h.send('GET', '/v1/memberships/invitations', {
      cookie: ownerA.cookie,
      company: companyA,
    });
    expect(list.status).toBe(200);
    const items = list.body['items'] as Record<string, unknown>[];
    expect(items.length).toBeGreaterThan(0);
    for (const row of items) {
      expect(row).not.toHaveProperty('set_password_link');
      expect(JSON.stringify(row)).not.toContain('reset-password');
    }
    const audit = await h.owner`
      SELECT entity, action FROM audit_log WHERE company_id = ${companyA}
        AND entity IN ('member_invitation', 'membership') ORDER BY entity`;
    expect(audit.map((row) => [row['entity'], row['action']])).toEqual([
      ['member_invitation', 'user.created'],
      ['membership', 'created'],
    ]);
    const [event] = await h.owner`
      SELECT payload FROM outbox WHERE company_id = ${companyA} AND event_type = 'MemberInvited'`;
    expect(event).toBeDefined();
    expect(JSON.stringify(event?.['payload'])).not.toContain('ahmed@example.test');
    // AC-G1-6: اللوجات قبل وبعد الاستهلاك مفيهاش التوكن ولا الرابط.
    expect(Buffer.concat(chunks).toString('utf8')).not.toContain(tokenOf(link));
    expect((await resetPassword(tokenOf(link), 'again-pass')).statusCode).toBe(400);
    expect(Buffer.concat(chunks).toString('utf8')).not.toContain(tokenOf(link));
  });
});

describe('N1 / P0 — an email that already has an account is refused, cross-company included', () => {
  it('company B inviting an email invited by company A gets 422 with no membership and no link', async () => {
    const companyA = await h.onboard(ownerA.cookie, 'G1 N1 A');
    const companyB = await h.onboard(ownerB.cookie, 'G1 N1 B');
    const first = await invite(ownerA.cookie, companyA, accountantBody(companyA, 'shared@example.test'));
    expect(first.status).toBe(201);
    const second = await invite(ownerB.cookie, companyB, accountantBody(companyB, 'shared@example.test'));
    expect([second.status, errorEnvelope.parse(second.body).code]).toEqual([
      422,
      'MEMBER_EMAIL_NOT_INVITABLE',
    ]);
    expect(second.body['set_password_link']).toBeUndefined();
    expect(
      await h.owner`SELECT count(*)::int AS n FROM memberships WHERE company_id = ${companyB}`,
    ).toEqual([{ n: 1 }]);
    // والحساب ليه كلمة مرور؟ نفس الرفض — القرار ما بيفرقش بين مفعّل وغير مفعّل.
    const token = first.body['set_password_link'] as string;
    await resetPassword(tokenOf(token), 'shared-chosen-pass');
    const third = await invite(ownerB.cookie, companyB, accountantBody(companyB, 'shared@example.test'));
    expect([third.status, errorEnvelope.parse(third.body).code]).toEqual([
      422,
      'MEMBER_EMAIL_NOT_INVITABLE',
    ]);
  });

  it('the owner inviting his own email is refused (his email already has an account)', async () => {
    const companyA = await h.onboard(ownerA.cookie, 'G1 N1 Self');
    const response = await invite(ownerA.cookie, companyA, accountantBody(companyA, ownerA.email));
    expect([response.status, errorEnvelope.parse(response.body).code]).toEqual([
      422,
      'MEMBER_EMAIL_NOT_INVITABLE',
    ]);
  });
});

describe('AC-G1-3 — the confirmation tick is schema-mandatory, for a new email and an existing one', () => {
  it('rejects the request without the confirmation, before any write', async () => {
    const companyA = await h.onboard(ownerA.cookie, 'G1 A3');
    const existing = await invite(ownerA.cookie, companyA, accountantBody(companyA, 'taken@example.test'));
    expect(existing.status).toBe(201);
    for (const email of ['unconfirmed@example.test', 'taken@example.test']) {
      for (const confirmation of [{}, { email_confirmed: false }]) {
        const response = await invite(ownerA.cookie, companyA, {
          email,
          name: 'Unconfirmed',
          role: 'accountant',
          scope: { type: 'COMPANY', id: companyA },
          ...confirmation,
        });
        expect(response.status).toBe(400);
        expect(errorEnvelope.parse(response.body).code).toBe('VALIDATION_FAILED');
      }
    }
    expect(await h.owner`SELECT 1 FROM "user" WHERE email = 'unconfirmed@example.test'`).toHaveLength(0);
  });
});
