import { errorEnvelope } from '@pospay/contracts';
import { OWNER_ROLE_ID } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

// إعادة إصدار الرابط (AC-G1-3b، P1-c): كل اختبار على fixtures مستقلة (شركة ودعوة خاصة)،
// والرفض بيتبعت بأسبابه: مالك تاني 403، شركة تانية 404، كلمة مرور متحطة 409، وانقطاع قبل
// كتابة العضوية مرفوض؛ وإصداران متزامنان بيسيبوا توكن حي واحد بس.
const ids = systemUuidV7();
let h: Harness;
const owner = { email: 'g1r-owner@example.test', cookie: '', userId: '' };
const secondOwner = { email: 'g1r-second@example.test', cookie: '', userId: '' };

beforeAll(async () => {
  h = await startHarness({ staffAccessRoutes: true });
  for (const who of [owner, secondOwner]) {
    who.cookie = await h.signedInOperator(who.email);
    const [row] = await h.owner`SELECT id FROM "user" WHERE email = ${who.email}`;
    who.userId = (row?.['id'] as string) ?? '';
  }
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

const reissue = (cookie: string, byCompany: string, id: string) =>
  h.send('POST', `/v1/memberships/invitations/${id}/link`, { cookie, company: byCompany });

/** دعوة كاملة لشركة جديدة بمالك جديد — fixtures مستقلة لكل اختبار (P2-d). */
async function inviteFresh(
  who: { cookie: string; userId: string },
  companyName: string,
  email: string,
): Promise<{ company: string; invitationId: string; firstToken: string }> {
  const company = await h.onboard(who.cookie, companyName);
  const invited = await h.send('POST', '/v1/memberships/invitations', {
    cookie: who.cookie,
    company,
    body: {
      email,
      name: 'Invited',
      role: 'accountant',
      scope: { type: 'COMPANY', id: company },
      email_confirmed: true,
    },
  });
  expect(invited.status).toBe(201);
  return {
    company,
    invitationId: invited.body['invitation_id'] as string,
    firstToken: tokenOf(invited.body['set_password_link'] as string),
  };
}

describe('AC-G1-3b — re-issuing a link the owner lost', () => {
  it('re-issues for a pending invitation and kills the earlier still-existing token', async () => {
    const fixture = await inviteFresh(owner, 'G1R Lost', 'lost@example.test');
    // الرابط القديم لسه موجود (متتشالش من قاعدة البيانات): إعادة الإصدار لازم تبطلُه فعلياً.
    const reissued = await reissue(owner.cookie, fixture.company, fixture.invitationId);
    expect(reissued.status).toBe(200);
    const secondToken = tokenOf(reissued.body['set_password_link'] as string);
    expect(secondToken).not.toBe(fixture.firstToken);
    expect((await resetPassword(fixture.firstToken, 'lost-chosen-pass')).statusCode).toBe(400);
    expect((await resetPassword(secondToken, 'lost-chosen-pass')).statusCode).toBe(200);
  });

  it('another owner in the same company is refused with FORBIDDEN', async () => {
    const fixture = await inviteFresh(owner, 'G1R Forbidden', 'forbidden@example.test');
    const [row] = await h.owner`
      SELECT count(*)::int AS n FROM member_invitations WHERE company_id = ${fixture.company}`;
    expect(row?.['n']).toBe(1);
    // مالك تاني كانوني في نفس الشركة (seed حقيقي، مش مجرد مستخدم).
    await h.owner`
      INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
      VALUES (${fixture.company}, ${ids.newId()}, ${secondOwner.userId}, ${OWNER_ROLE_ID}::uuid,
              'global', 'COMPANY', ${fixture.company})`;
    const response = await reissue(secondOwner.cookie, fixture.company, fixture.invitationId);
    expect([response.status, errorEnvelope.parse(response.body).code]).toEqual([403, 'FORBIDDEN']);
  });

  it('another company cannot see or re-issue the invitation at all', async () => {
    const fixture = await inviteFresh(owner, 'G1R Cross', 'cross@example.test');
    const otherCompany = await h.onboard(secondOwner.cookie, 'G1R Cross Other');
    const response = await reissue(secondOwner.cookie, otherCompany, fixture.invitationId);
    expect([response.status, errorEnvelope.parse(response.body).code]).toEqual([404, 'NOT_FOUND']);
  });

  it('a member who already set a password is refused a new link', async () => {
    const fixture = await inviteFresh(owner, 'G1R Consumed', 'consumed@example.test');
    await resetPassword(fixture.firstToken, 'consumed-chosen-pass');
    const response = await reissue(owner.cookie, fixture.company, fixture.invitationId);
    expect([response.status, errorEnvelope.parse(response.body).code]).toEqual([
      409,
      'MEMBER_INVITATION_NOT_REISSUEABLE',
    ]);
  });

  it('an invitation whose membership was never written is refused (P1-c)', async () => {
    const fixture = await inviteFresh(owner, 'G1R NoMembership', 'nomembership@example.test');
    // انقطاع بعد الخطوة التانية: العضوية مش مكتوبة لسه على صف الدعوة.
    await h.owner`
      UPDATE member_invitations SET membership_id = NULL, user_id = NULL
      WHERE company_id = ${fixture.company} AND id = ${fixture.invitationId}`;
    const response = await reissue(owner.cookie, fixture.company, fixture.invitationId);
    expect([response.status, errorEnvelope.parse(response.body).code]).toEqual([
      409,
      'MEMBER_INVITATION_NOT_REISSUEABLE',
    ]);
  });

  it('two concurrent re-issues leave exactly one live token (P1-c)', async () => {
    const fixture = await inviteFresh(owner, 'G1R Concurrent', 'concurrent@example.test');
    const [first, second] = await Promise.all([
      reissue(owner.cookie, fixture.company, fixture.invitationId),
      reissue(owner.cookie, fixture.company, fixture.invitationId),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const tokens = [
      tokenOf(first.body['set_password_link'] as string),
      tokenOf(second.body['set_password_link'] as string),
    ];
    const [live] = await h.owner`
      SELECT identifier FROM verification
      WHERE value = (SELECT user_id FROM member_invitations
                     WHERE company_id = ${fixture.company} AND id = ${fixture.invitationId})
        AND identifier LIKE 'reset-password:%'`;
    expect(live).toBeDefined();
    const liveToken = String(live?.['identifier']).replace('reset-password:', '');
    // التوكن الحي من الإصدار الأخير بيشتغل، والقديم من الإصدار الأول مات بالإبطال.
    expect(tokens).toContain(liveToken);
    expect((await resetPassword(liveToken, 'concurrent-pass')).statusCode).toBe(200);
    const deadTokens = tokens.filter((token) => token !== liveToken);
    for (const token of deadTokens) {
      expect((await resetPassword(token, 'concurrent-pass')).statusCode).toBe(400);
    }
    const [count] = await h.owner`
      SELECT count(*)::int AS n FROM verification
      WHERE value = (SELECT user_id FROM member_invitations
                     WHERE company_id = ${fixture.company} AND id = ${fixture.invitationId})
        AND identifier LIKE 'reset-password:%'`;
    expect(count?.['n']).toBe(1);
  });
});
