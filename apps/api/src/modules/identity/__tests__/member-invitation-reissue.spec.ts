import { errorEnvelope } from '@pospay/contracts';
import { OWNER_ROLE_ID } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

// إعادة إصدار الرابط (AC-G1-3b، P1-c): كل اختبار على fixtures مستقلة (مالك وشركة ودعوة خاصة،
// لأن حد الدعوات عشرة في الساعة لكل مالك)؛ والرفض بأسبابه: مالك تاني 403 والرابط القديم لسه حي،
// شركة تانية 409، كلمة مرور متحطة 409، وعضوية ما اتكتبتش 409؛ وإصداران متزامنان بيسيبوا توكن
// حي واحد بس.
const ids = systemUuidV7();
let h: Harness;
let counter = 0;

beforeAll(async () => {
  h = await startHarness({ staffAccessRoutes: true });
});

afterAll(async () => {
  await h?.close();
});

const tokenOf = (link: string) => new URL(link).pathname.split('/').pop() ?? '';

const resetPassword = (token: string, newPassword: string) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/auth/reset-password',
    headers: { origin: 'http://admin.test' },
    payload: { token, newPassword },
  });

const reissue = (cookie: string, company: string, id: string) =>
  h.send('POST', `/v1/memberships/invitations/${id}/link`, { cookie, company });
const codeOf = (response: { status: number; body: Record<string, unknown> }) => [
  response.status,
  errorEnvelope.parse(response.body).code,
];

/** مالك جديد وشركة جديدة ودعوة محاسب كاملة — fixtures مستقلة لكل اختبار (P2-d). */
async function inviteFresh(label: string) {
  counter += 1;
  const email = `g1r-${label}-${counter}@example.test`;
  const cookie = await h.signedInOperator(email);
  const [row] = await h.owner`SELECT id FROM "user" WHERE email = ${email}`;
  const owner = { cookie, userId: String(row?.['id']) };
  const company = await h.onboard(cookie, `G1R ${label}`);
  const invited = await h.send('POST', '/v1/memberships/invitations', {
    cookie,
    company,
    body: {
      email: `invited-${label}-${counter}@example.test`,
      name: 'Invited',
      role: 'accountant',
      scope: { type: 'COMPANY', id: company },
      email_confirmed: true,
    },
  });
  expect(invited.status).toBe(201);
  return {
    owner,
    company,
    invitationId: invited.body['invitation_id'] as string,
    firstToken: tokenOf(invited.body['set_password_link'] as string),
  };
}

const liveTokens = (company: string, invitationId: string) => h.owner`
  SELECT identifier FROM verification
  WHERE value = (SELECT user_id::text FROM member_invitations
                 WHERE company_id = ${company} AND id = ${invitationId})
    AND identifier LIKE 'reset-password:%'`;

describe('AC-G1-3b — re-issuing a link the owner lost', () => {
  it('re-issues for a pending invitation and kills the earlier still-existing token', async () => {
    const fixture = await inviteFresh('lost');
    expect(await liveTokens(fixture.company, fixture.invitationId)).toHaveLength(1);
    const reissued = await reissue(fixture.owner.cookie, fixture.company, fixture.invitationId);
    expect(reissued.status).toBe(200);
    const secondToken = tokenOf(reissued.body['set_password_link'] as string);
    expect(secondToken).not.toBe(fixture.firstToken);
    expect((await resetPassword(fixture.firstToken, 'lost-chosen-pass')).statusCode).toBe(400);
    expect((await resetPassword(secondToken, 'lost-chosen-pass')).statusCode).toBe(200);
    const audit = await h.owner`
      SELECT action FROM audit_log WHERE company_id = ${fixture.company} AND entity_id = ${fixture.invitationId}
        AND action LIKE 'link.%'`;
    expect(audit.map((row) => row['action']).sort()).toEqual([
      'link.issued',
      'link.issued',
      'link.reissue_requested',
    ]);
  });

  it('another owner in the same company is refused and the live link is untouched', async () => {
    const fixture = await inviteFresh('forbidden');
    const secondEmail = `g1r-second-${counter}@example.test`;
    const secondCookie = await h.signedInOperator(secondEmail);
    const [second] = await h.owner`SELECT id FROM "user" WHERE email = ${secondEmail}`;
    await h.owner`
      INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
      VALUES (${fixture.company}, ${ids.newId()}, ${second?.['id']}, ${OWNER_ROLE_ID}::uuid,
              'global', 'COMPANY', ${fixture.company})`;
    const response = await reissue(secondCookie, fixture.company, fixture.invitationId);
    expect(codeOf(response)).toEqual([409, 'MEMBER_INVITATION_NOT_REISSUEABLE']);
    expect(await liveTokens(fixture.company, fixture.invitationId)).toEqual([
      { identifier: `reset-password:${fixture.firstToken}` },
    ]);
  });

  it('another company cannot re-issue the invitation and learns nothing about it', async () => {
    const fixture = await inviteFresh('cross');
    const other = await inviteFresh('cross-other');
    const response = await reissue(other.owner.cookie, other.company, fixture.invitationId);
    expect(codeOf(response)).toEqual([409, 'MEMBER_INVITATION_NOT_REISSUEABLE']);
    expect(await liveTokens(fixture.company, fixture.invitationId)).toEqual([
      { identifier: `reset-password:${fixture.firstToken}` },
    ]);
  });
});

describe('AC-G1-3b — re-issue refusals and concurrency', () => {
  it('a member who already set a password is refused a new link', async () => {
    const fixture = await inviteFresh('consumed');
    expect((await resetPassword(fixture.firstToken, 'consumed-chosen-pass')).statusCode).toBe(200);
    const response = await reissue(fixture.owner.cookie, fixture.company, fixture.invitationId);
    expect(codeOf(response)).toEqual([409, 'MEMBER_INVITATION_NOT_REISSUEABLE']);
    expect(await liveTokens(fixture.company, fixture.invitationId)).toHaveLength(0);
  });

  it('an invitation whose membership was never written is refused (P1-c)', async () => {
    const fixture = await inviteFresh('nomembership');
    // حساب موجود وصف الدعوة شايل user_id، لكن العضوية مش مكتوبة: الفحص على membership_id لوحده هو اللي بيرفض.
    await h.owner`
      UPDATE member_invitations SET membership_id = NULL
      WHERE company_id = ${fixture.company} AND id = ${fixture.invitationId}`;
    const response = await reissue(fixture.owner.cookie, fixture.company, fixture.invitationId);
    expect(codeOf(response)).toEqual([409, 'MEMBER_INVITATION_NOT_REISSUEABLE']);
  });

  it('two concurrent re-issues leave exactly one live token (P1-c)', async () => {
    const fixture = await inviteFresh('concurrent');
    const [first, second] = await Promise.all([
      reissue(fixture.owner.cookie, fixture.company, fixture.invitationId),
      reissue(fixture.owner.cookie, fixture.company, fixture.invitationId),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const tokens = [first, second].map((r) => tokenOf(r.body['set_password_link'] as string));
    const live = await liveTokens(fixture.company, fixture.invitationId);
    expect(live).toHaveLength(1);
    const liveToken = String(live[0]?.['identifier']).replace('reset-password:', '');
    expect(tokens).toContain(liveToken);
    for (const token of tokens.filter((candidate) => candidate !== liveToken)) {
      expect((await resetPassword(token, 'concurrent-pass')).statusCode).toBe(400);
    }
    expect((await resetPassword(liveToken, 'concurrent-pass')).statusCode).toBe(200);
  });
});
