import { errorEnvelope } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

// دعوة عضو (076 G1) عبر المسارات الحقيقية: مالك الشركة بس، والرابط مرة واحدة، وأي إيميل له حساب
// بيترفض (N1، شاملاً شركة تانية). كل اختبار على AC بالاسم من spec §4 G1، بـ fixtures مستقلة.
const ORIGIN = 'http://admin.test';
let h: Harness;
const ownerA = { email: 'g1-owner-a@example.test', cookie: '', userId: '' };
const ownerB = { email: 'g1-owner-b@example.test', cookie: '', userId: '' };

let freshCounter = 0;
const role = (code: string) => SYSTEM_ROLES.find((r) => r.code === code)?.id ?? '';

beforeAll(async () => {
  h = await startHarness({ staffAccessRoutes: true });
  for (const who of [ownerA, ownerB]) {
    who.cookie = await h.signedInOperator(who.email);
    const [row] = await h.owner`SELECT id FROM "user" WHERE email = ${who.email}`;
    who.userId = (row?.['id'] as string) ?? '';
  }
});

/** مالك جديد بحدّه الخاص: حد الدعوات عشرة في الساعة لكل مالك، فالاختبارات الكتيرة ما بتتشاركش مالك. */
async function freshOwner(label: string) {
  freshCounter += 1;
  const email = `g1-fresh-${label}-${freshCounter}@example.test`;
  const cookie = await h.signedInOperator(email);
  const [row] = await h.owner`SELECT id FROM "user" WHERE email = ${email}`;
  return { email, cookie, userId: String(row?.['id']) };
}

afterAll(async () => {
  await h?.close();
});

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
const linkRequest = (link: string) => {
  const url = new URL(link);
  return h.app.inject({
    method: 'GET',
    url: url.pathname + url.search,
    headers: { origin: ORIGIN },
  });
};
const resetPassword = (token: string, newPassword: string) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/auth/reset-password',
    headers: { origin: ORIGIN },
    payload: { token, newPassword },
  });
const codeOf = (response: { status: number; body: Record<string, unknown> }) => [
  response.status,
  errorEnvelope.parse(response.body).code,
];

/** سجلات الدعوة الكاملة: العضوية، علامة اليوزر، القائمة من غير سر، التدقيق، وحدث من غير إيميل. */
async function expectInvitedRecords(company: string, invitationId: string, token: string) {
  const [membership] = await h.owner`
      SELECT id, role_id, role_owner_key, scope_type, scope_id, user_id FROM memberships
      WHERE company_id = ${company} AND user_id <> ${ownerA.userId}`;
  expect(membership).toMatchObject({
    role_id: role('accountant'),
    role_owner_key: 'global',
    scope_type: 'COMPANY',
    scope_id: company,
  });
  const [invitedUser] = await h.owner`
      SELECT invited_by_company_id, invitation_operation_id FROM "user" WHERE id = ${membership?.['user_id']}`;
  expect(invitedUser).toMatchObject({
    invited_by_company_id: company,
    invitation_operation_id: invitationId,
  });
  const list = await h.send('GET', '/v1/memberships/invitations', {
    cookie: ownerA.cookie,
    company,
  });
  expect(list.status).toBe(200);
  expect(JSON.stringify(list.body)).not.toContain(token);
  expect(JSON.stringify(list.body)).not.toContain('ahmed@example.test');
  const audit = await h.owner`
      SELECT entity, action FROM audit_log WHERE company_id = ${company}
        AND (entity = 'member_invitation' OR entity_id = ${membership?.['id']})`;
  expect(audit.map((row) => `${row['entity']}:${row['action']}`).sort()).toEqual([
    'member_invitation:invite.opened',
    'member_invitation:link.issued',
    'member_invitation:user.created',
    'membership:created',
  ]);
  const events = await h.owner`
      SELECT payload FROM outbox WHERE company_id = ${company} AND event_type = 'MemberInvited'`;
  expect(events).toHaveLength(1);
  expect(JSON.stringify(events[0]?.['payload'])).not.toContain('ahmed@example.test');
}

describe('AC-G1-1 — inviting an accountant creates the user, the membership and a one-time link', () => {
  it('opens the real link, sets a password, signs in, and never returns the link again', async () => {
    const company = await h.onboard(ownerA.cookie, 'G1 Company A1');
    const response = await invite(
      ownerA.cookie,
      company,
      accountantBody(company, 'ahmed@example.test'),
    );
    expect(response.status).toBe(201);
    const link = response.body['set_password_link'] as string;
    const token = tokenOf(link);
    const opened = await linkRequest(link);
    expect(opened.statusCode).toBe(302);
    expect(String(opened.headers['location'])).toContain(`${ORIGIN}/set-password?token=${token}`);
    expect((await resetPassword(token, 'ahmed-chosen-pass')).statusCode).toBe(200);
    const signedIn = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/sign-in/email',
      headers: { origin: ORIGIN },
      payload: { email: 'ahmed@example.test', password: 'ahmed-chosen-pass' },
    });
    expect(signedIn.statusCode).toBe(200);
    const reopened = await linkRequest(link);
    expect(String(reopened.headers['location'])).toContain('error=INVALID_TOKEN');
    expect((await resetPassword(token, 'again-pass')).statusCode).toBe(400);

    await expectInvitedRecords(company, String(response.body['invitation_id']), token);
  });

  it('answers 409 to a repeat before the password is set and 422 once it is, with no second link', async () => {
    const fresh = await freshOwner('repeat');
    const company = await h.onboard(fresh.cookie, 'G1 Company A1b');
    const first = await invite(
      fresh.cookie,
      company,
      accountantBody(company, 'repeat@example.test'),
    );
    expect(first.status).toBe(201);
    const repeat = await invite(
      fresh.cookie,
      company,
      accountantBody(company, 'repeat@example.test'),
    );
    expect(codeOf(repeat)).toEqual([409, 'MEMBER_INVITATION_EXISTS']);
    expect(repeat.body['set_password_link']).toBeUndefined();
    await resetPassword(tokenOf(first.body['set_password_link'] as string), 'repeat-chosen-pass');
    const afterPassword = await invite(
      fresh.cookie,
      company,
      accountantBody(company, 'repeat@example.test'),
    );
    expect(codeOf(afterPassword)).toEqual([422, 'MEMBER_EMAIL_NOT_INVITABLE']);
    expect(
      await h.owner`SELECT count(*)::int AS n FROM outbox WHERE company_id = ${company} AND event_type = 'MemberInvited'`,
    ).toEqual([{ n: 1 }]);
  });
});

/** الشركة الرافضة ما كتبتش عضوية ولا صف دعوة، ومفيش رابط جديد على الحساب (اللي عليه رابط واحد بس أو صفر). */
async function expectNothingWritten(company: string, victimId: string, links = 1) {
  expect(
    await h.owner`SELECT count(*)::int AS n FROM memberships WHERE company_id = ${company} AND user_id = ${victimId}`,
  ).toEqual([{ n: 0 }]);
  expect(
    await h.owner`SELECT count(*)::int AS n FROM member_invitations WHERE company_id = ${company}`,
  ).toEqual([{ n: 0 }]);
  expect(
    await h.owner`SELECT count(*)::int AS n FROM verification WHERE value = ${victimId}`,
  ).toEqual([{ n: links }]);
}

describe('N1 / P0 — an email that already has an account is refused, cross-company included', () => {
  it('company B inviting an email company A invited gets 422, with no membership, no link and no row', async () => {
    const companyA = await h.onboard(ownerA.cookie, 'G1 N1 A');
    const companyB = await h.onboard(ownerB.cookie, 'G1 N1 B');
    const first = await invite(
      ownerA.cookie,
      companyA,
      accountantBody(companyA, 'shared@example.test'),
    );
    expect(first.status).toBe(201);
    const [victim] = await h.owner`SELECT id FROM "user" WHERE email = 'shared@example.test'`;
    const second = await invite(
      ownerB.cookie,
      companyB,
      accountantBody(companyB, 'shared@example.test'),
    );
    expect(codeOf(second)).toEqual([422, 'MEMBER_EMAIL_NOT_INVITABLE']);
    expect(second.body['set_password_link']).toBeUndefined();
    await expectNothingWritten(companyB, String(victim?.['id']));
    // نفس الرفض بعد ما صاحب الحساب حط كلمة مروره: القرار ما بيفرقش بين مفعّل وغير مفعّل.
    await resetPassword(tokenOf(first.body['set_password_link'] as string), 'shared-chosen-pass');
    const third = await invite(
      ownerB.cookie,
      companyB,
      accountantBody(companyB, 'shared@example.test'),
    );
    expect(codeOf(third)).toEqual([422, 'MEMBER_EMAIL_NOT_INVITABLE']);
    await expectNothingWritten(companyB, String(victim?.['id']), 0);
    // الرفض اتسجّل بتدقيق من غير الإيميل (spec §8).
    const refusals = await h.owner`
      SELECT after FROM audit_log WHERE company_id = ${companyB} AND action = 'invite.refused'`;
    expect(refusals).toHaveLength(2);
    expect(JSON.stringify(refusals)).not.toContain('shared@example.test');
  });

  it('refuses an operator account, the owner own email and a staff-domain email the same way', async () => {
    const fresh = await freshOwner('other');
    const company = await h.onboard(fresh.cookie, 'G1 N1 Other');
    await h.signedInOperator('g1-existing-operator@example.test');
    for (const email of [
      'g1-existing-operator@example.test',
      fresh.email,
      'sara-0192@staff.pospay.invalid',
    ]) {
      expect(codeOf(await invite(fresh.cookie, company, accountantBody(company, email)))).toEqual([
        422,
        'MEMBER_EMAIL_NOT_INVITABLE',
      ]);
    }
    expect(
      await h.owner`SELECT count(*)::int AS n FROM memberships WHERE company_id = ${company}`,
    ).toEqual([{ n: 1 }]);
  });
});

describe('AC-ACT-21 — the invitation link goes to the admin origin by name', () => {
  it('builds the set-password address from the admin origin, not from the API origin', async () => {
    const company = await h.onboard(ownerA.cookie, 'G1 AC-ACT-21');
    const response = await invite(
      ownerA.cookie,
      company,
      accountantBody(company, 'act-21@example.test'),
    );
    expect(response.status).toBe(201);
    const link = response.body['set_password_link'] as string;
    const url = new URL(link);
    // عنوان صفحة تعيين كلمة المرور هو أصل لوحة الإدارة (ADMIN_ORIGIN)، مش أصل الـ API اللي
    // الرابط جاي منه.
    expect(url.searchParams.get('callbackURL')).toBe(`${ORIGIN}/set-password`);
    const opened = await linkRequest(link);
    expect(opened.statusCode).toBe(302);
    expect(String(opened.headers['location'])).toContain(
      `${ORIGIN}/set-password?token=${tokenOf(link)}`,
    );
  });
});

describe('AC-G1-3 — the confirmation tick is schema-mandatory, for a new email and an existing one', () => {
  it('rejects the request without the confirmation, before any write', async () => {
    const company = await h.onboard(ownerA.cookie, 'G1 A3');
    expect(
      (await invite(ownerA.cookie, company, accountantBody(company, 'taken@example.test'))).status,
    ).toBe(201);
    for (const email of ['unconfirmed@example.test', 'taken@example.test']) {
      for (const confirmation of [{}, { email_confirmed: false }]) {
        const response = await invite(ownerA.cookie, company, {
          ...accountantBody(company, email),
          email_confirmed: undefined,
          ...confirmation,
        });
        expect(codeOf(response)).toEqual([400, 'VALIDATION_FAILED']);
      }
    }
    expect(
      await h.owner`SELECT 1 FROM "user" WHERE email = 'unconfirmed@example.test'`,
    ).toHaveLength(0);
    expect(
      await h.owner`SELECT count(*)::int AS n FROM member_invitations WHERE company_id = ${company}`,
    ).toEqual([{ n: 1 }]);
  });
});
