import { errorEnvelope } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';
import { systemClock } from '../../../shared/adapters/system-clock.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { createMemberInvitationTransactions } from '../persistence/member-invitation-transactions.ts';

// الاستئناف بعد انقطاع (D6): كل نقطة انقطاع بين خطوات الدعوة الأربع بتتكمل بتكرار نفس الطلب،
// من غير حساب مكرر ولا عضوية مكررة ولا حدث ثاني، وبرابط واحد؛ والرابط المحجوز من غير إصدار
// بيتعوّض بإعادة الإصدار مش بتكرار الدعوة.
const ids = systemUuidV7();
let h: Harness;
const owner = { email: 'g1rs-owner@example.test', cookie: '', userId: '' };

beforeAll(async () => {
  h = await startHarness({ staffAccessRoutes: true });
  owner.cookie = await h.signedInOperator(owner.email);
  const [row] = await h.owner`SELECT id FROM "user" WHERE email = ${owner.email}`;
  owner.userId = (row?.['id'] as string) ?? '';
});

afterAll(async () => {
  await h?.close();
});

const transactions = () => createMemberInvitationTransactions(h.app.get(DATABASE), ids);
const body = (company: string, email: string) => ({
  email,
  name: 'Resumed',
  role: 'accountant',
  scope: { type: 'COMPANY', id: company },
  email_confirmed: true,
});
const invite = (company: string, email: string, cookie = owner.cookie) =>
  h.send('POST', '/v1/memberships/invitations', { cookie, company, body: body(company, email) });

/** يقف الدعوة عند خطوة معيّنة بالخطوات الحقيقية نفسها، كأن الطلب انقطع بعدها. */
async function crashAfter(step: 'open' | 'account' | 'complete' | 'claim', email: string) {
  const company = await h.onboard(owner.cookie, `G1 Resume ${step}`);
  const who = { companyId: company, actorUserId: owner.userId };
  const opened = await transactions().open({
    ...who,
    invitationId: ids.newId(),
    emailHash: h.auth.members.hashEmail(email),
    roleCode: 'accountant',
    scope: { type: 'COMPANY', id: company },
    now: systemClock.now(),
  });
  if (!('invitationId' in opened)) throw new Error('open refused');
  const invitationId = opened.invitationId;
  if (step === 'open') return { company, invitationId };
  const account = await h.auth.members.createInvitedMember({
    operationId: invitationId,
    companyId: company,
    email,
    name: 'Resumed',
  });
  if (step === 'account') return { company, invitationId };
  const outcome = await transactions().complete({
    ...who,
    invitationId,
    membershipId: ids.newId(),
    userId: account.userId,
    buildEvent: (row, membershipId, userId) => ({
      aggregateType: 'member_invitation',
      aggregateId: row.id,
      eventType: 'MemberInvited',
      payload: { invitation_id: row.id, user_id: userId, membership_id: membershipId },
    }),
    buildAudit: () => [],
    now: systemClock.now(),
  });
  expect(outcome).toMatchObject({ done: true, alreadyComplete: false });
  if (step === 'complete') return { company, invitationId };
  expect(
    await transactions().claimLink({ companyId: company, invitationId, at: systemClock.now() }),
  ).toBe(true);
  return { company, invitationId };
}

describe('resuming an interrupted invitation', () => {
  it.each(['open', 'account', 'complete'] as const)(
    'a repeat after a crash following the %s step finishes it with one user, one membership and one link',
    async (step) => {
      const email = `resume-${step}@example.test`;
      const { company, invitationId } = await crashAfter(step, email);
      const response = await invite(company, email);
      expect(response.status).toBe(201);
      expect(response.body['invitation_id']).toBe(invitationId);
      expect(String(response.body['set_password_link'])).toContain('/reset-password/');
      expect(await h.owner`SELECT 1 FROM "user" WHERE email = ${email}`).toHaveLength(1);
      expect(
        await h.owner`SELECT count(*)::int AS n FROM memberships WHERE company_id = ${company}`,
      ).toEqual([{ n: 2 }]);
      expect(
        await h.owner`SELECT count(*)::int AS n FROM outbox WHERE company_id = ${company} AND event_type = 'MemberInvited'`,
      ).toEqual([{ n: 1 }]);
    },
  );
});

describe('resuming after the link was claimed, and the takeover guard', () => {
  it('a repeat after the link was claimed but never written answers 409 and the re-issue route completes it', async () => {
    const { company, invitationId } = await crashAfter('claim', 'resume-claim@example.test');
    // الحجز لوحده ما بيختمش الإصدار: لا توكن اتكتب ولا link_issued_at اتسجل (P2-a).
    expect(
      await h.owner`SELECT link_claimed_at IS NOT NULL AS claimed, link_issued_at IS NOT NULL AS issued
        FROM member_invitations WHERE company_id = ${company} AND id = ${invitationId}`,
    ).toEqual([{ claimed: true, issued: false }]);
    expect(
      await h.owner`SELECT 1 FROM verification WHERE identifier LIKE 'reset-password:%' AND value = (SELECT user_id::text FROM member_invitations WHERE company_id = ${company} AND id = ${invitationId})`,
    ).toHaveLength(0);
    const repeat = await invite(company, 'resume-claim@example.test');
    expect([repeat.status, errorEnvelope.parse(repeat.body).code]).toEqual([
      409,
      'MEMBER_INVITATION_EXISTS',
    ]);
    const reissued = await h.send('POST', `/v1/memberships/invitations/${invitationId}/link`, {
      cookie: owner.cookie,
      company,
    });
    expect(reissued.status).toBe(200);
    expect(String(reissued.body['set_password_link'])).toContain('/reset-password/');
    const [row] = await h.owner`
      SELECT link_claimed_at IS NOT NULL AS claimed, link_issued_at IS NOT NULL AS issued
      FROM member_invitations WHERE company_id = ${company} AND id = ${invitationId}`;
    expect(row).toEqual({ claimed: true, issued: true });
  });

  it('a resume with another role is refused 409 and the pending row keeps its role (P1-b)', async () => {
    const { company, invitationId } = await crashAfter('account', 'resume-role@example.test');
    const response = await h.send('POST', '/v1/memberships/invitations', {
      cookie: owner.cookie,
      company,
      body: { ...body(company, 'resume-role@example.test'), role: 'general_manager' },
    });
    expect([response.status, errorEnvelope.parse(response.body).code]).toEqual([
      409,
      'MEMBER_INVITATION_EXISTS',
    ]);
    expect(
      await h.owner`SELECT role_code, membership_id FROM member_invitations
        WHERE company_id = ${company} AND id = ${invitationId}`,
    ).toEqual([{ role_code: 'accountant', membership_id: null }]);
  });
});

describe('the takeover guard', () => {
  it('a different owner cannot take over a pending invitation of the same email', async () => {
    const { company } = await crashAfter('account', 'resume-takeover@example.test');
    const second = { email: 'g1rs-second@example.test', cookie: '', userId: '' };
    second.cookie = await h.signedInOperator(second.email);
    const [row] = await h.owner`SELECT id FROM "user" WHERE email = ${second.email}`;
    second.userId = String(row?.['id']);
    await h.owner`
      INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
      SELECT ${company}, ${ids.newId()}, ${second.userId}, role_id, role_owner_key, scope_type, scope_id
      FROM memberships WHERE company_id = ${company} AND user_id = ${owner.userId}`;
    const before =
      await h.owner`SELECT count(*)::int AS n FROM memberships WHERE company_id = ${company}`;
    const response = await invite(company, 'resume-takeover@example.test', second.cookie);
    expect([response.status, errorEnvelope.parse(response.body).code]).toEqual([
      409,
      'MEMBER_INVITATION_EXISTS',
    ]);
    expect(
      await h.owner`SELECT count(*)::int AS n FROM memberships WHERE company_id = ${company}`,
    ).toEqual(before);
  });
});
