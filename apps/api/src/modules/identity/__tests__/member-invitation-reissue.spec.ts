import { errorEnvelope } from '@pospay/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

// استرجاع الدعوة (076 G1، AC-G1-3b): حالة الانقطاع بعد الخطوة الثالثة — عضوية مكتوبة ورابط
// ما اتطلعش — بيتمثّل هنا بحذف أثر الرابط، وفالمسار الحقيقي لإعادة الإصدار بيكمّل بشروطه:
// صاحب الدعوة بس، الدعوة لسه PENDING، والعضو ما حطش كلمة مروره. الصف المخزن بيفضل PENDING
// بعد إعادة الإصدار؛ حالة ACTIVE بتتحسب وقت قراءة القائمة (plan §5).
let h: Harness;
const crashOwner = { email: 'g1-reissue-owner@example.test', cookie: '', userId: '' };
const otherOwner = { email: 'g1-reissue-second@example.test', cookie: '', userId: '' };
let company: string;
let invitationId: string;
let firstToken: string;

beforeAll(async () => {
  h = await startHarness({ staffAccessRoutes: true });
  crashOwner.cookie = await h.signedInOperator(crashOwner.email);
  otherOwner.cookie = await h.signedInOperator(otherOwner.email);
  for (const who of [crashOwner, otherOwner]) {
    const [row] = await h.owner`SELECT id FROM "user" WHERE email = ${who.email}`;
    who.userId = (row?.['id'] as string) ?? '';
  }
  company = await h.onboard(crashOwner.cookie, 'G1 Reissue Company');
});

afterAll(async () => {
  await h?.close();
});

const invite = (email: string) =>
  h.send('POST', '/v1/memberships/invitations', {
    cookie: crashOwner.cookie,
    company,
    body: {
      email,
      name: 'Crashed',
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

const reissue = (cookie: string, byCompany: string, id: string) =>
  h.send('POST', `/v1/memberships/invitations/${id}/link`, { cookie, company: byCompany });

/** حالة الانقطاع بين 3 و4: عضوية مكتوبة والدعوة PENDING من غير رابط ولا صف verification. */
const simulateCrashAfterComplete = async (id: string, link: string) => {
  await h.owner`
    UPDATE member_invitations SET link_issued_at = NULL WHERE company_id = ${company} AND id = ${id}`;
  await h.owner`DELETE FROM verification WHERE identifier = ${`reset-password:${tokenOf(link)}`}`;
};

describe('AC-G1-3b — the inviting owner re-issues a link after a crash', () => {
  it('re-issues for a pending invitation whose member never set a password, and the earlier link dies', async () => {
    const invited = await invite('crashed@example.test');
    expect(invited.status).toBe(201);
    invitationId = invited.body['invitation_id'] as string;
    firstToken = tokenOf(invited.body['set_password_link'] as string);
    await simulateCrashAfterComplete(invitationId, invited.body['set_password_link'] as string);
    const reissued = await reissue(crashOwner.cookie, company, invitationId);
    expect(reissued.status).toBe(200);
    const secondToken = tokenOf(reissued.body['set_password_link'] as string);
    expect(secondToken).not.toBe(firstToken);
    // الرابط القديم انبطل بالإصدار الجديد، والجديد يشتغل مرة واحدة.
    expect((await resetPassword(firstToken, 'crashed-chosen-pass')).statusCode).toBe(400);
    expect((await resetPassword(secondToken, 'crashed-chosen-pass')).statusCode).toBe(200);
  });

  it('another owner in the same company is refused', async () => {
    const response = await reissue(otherOwner.cookie, company, invitationId);
    expect([response.status, errorEnvelope.parse(response.body).code]).toEqual([403, 'FORBIDDEN']);
  });

  it('another company cannot see or re-issue the invitation at all', async () => {
    const secondCompany = await h.onboard(otherOwner.cookie, 'G1 Reissue Company 2');
    const response = await reissue(otherOwner.cookie, secondCompany, invitationId);
    expect([response.status, errorEnvelope.parse(response.body).code]).toEqual([404, 'NOT_FOUND']);
  });

  it('a member who already set a password is refused a new link', async () => {
    // العضو حط كلمة مروره في الاختبار الأول؛ الصف لسه PENDING المخزن والرفض من علامة الهوية.
    const response = await reissue(crashOwner.cookie, company, invitationId);
    expect([response.status, errorEnvelope.parse(response.body).code]).toEqual([
      409,
      'MEMBER_INVITATION_NOT_REISSUEABLE',
    ]);
  });
});
