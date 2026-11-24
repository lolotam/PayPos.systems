import { errorEnvelope } from '@pospay/contracts';
import { OWNER_ROLE_ID, SYSTEM_ROLES } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMemberInvitationTransactions } from '../persistence/member-invitation-transactions.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { systemClock } from '../../../shared/adapters/system-clock.ts';

// سلطة الدعوة (AC-G1-4، P1-a): مالك كانوني بس، والفحص بيتعيد جوه معاملة الإتمام ومسار
// إعادة الإصدار؛ والسباق على نفس الإيميل بأدوار مختلفة بيسيب عضوية واحدة بدور الفايز (P1-b).
const ids = systemUuidV7();
let h: Harness;
const ownerA = { email: 'g1x-owner-a@example.test', cookie: '', userId: '' };
const ownerA2 = { email: 'g1x-owner-a2@example.test', cookie: '', userId: '' };

const role = (code: string) => SYSTEM_ROLES.find((r) => r.code === code)?.id ?? '';

beforeAll(async () => {
  h = await startHarness({ staffAccessRoutes: true });
  for (const who of [ownerA, ownerA2]) {
    who.cookie = await h.signedInOperator(who.email);
    const [row] = await h.owner`SELECT id FROM "user" WHERE email = ${who.email}`;
    who.userId = (row?.['id'] as string) ?? '';
  }
});

afterAll(async () => {
  await h?.close();
});

const invite = (cookie: string, company: string, body: object) =>
  h.send('POST', '/v1/memberships/invitations', { cookie, company, body });

const bodyFor = (company: string, email: string, extra: object = {}) => ({
  email,
  name: 'Invited',
  role: 'accountant',
  scope: { type: 'COMPANY', id: company },
  email_confirmed: true,
  ...extra,
});

const addSystemRoleMember = async (
  company: string,
  userId: string,
  roleCode: string,
  scopeType: string,
  scopeId: string,
) => {
  await h.owner`
    INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
    VALUES (${company}, ${ids.newId()}, ${userId}, ${role(roleCode)}, 'global', ${scopeType}, ${scopeId})`;
};

const addBusinessAndBranch = async (company: string) => {
  const business = ids.newId();
  const branch = ids.newId();
  await h.owner`
    INSERT INTO businesses (company_id, id, name_en, vertical_type)
    VALUES (${company}, ${business}, 'G1 business', 'salon')`;
  await h.owner`
    INSERT INTO branches (company_id, id, business_id, name_en)
    VALUES (${company}, ${branch}, ${business}, 'G1 branch')`;
  return { business, branch };
};

/** مالك تاني كانوني في نفس الشركة — للسباق واختبار الرفض. */
const addSecondOwner = async (company: string, who: { userId: string }) => {
  await addSystemRoleMember(company, who.userId, 'owner', 'COMPANY', company);
};

describe('AC-G1-4 — authority at open: non-owners get 403', () => {
  it('a general manager and a branch manager get 403', async () => {
    const companyA = await h.onboard(ownerA.cookie, 'G1X Company A5');
    const { branch } = await addBusinessAndBranch(companyA);
    const body = bodyFor(companyA, 'forbidden@example.test');
    for (const [email, roleCode, scopeType, scopeId] of [
      ['g1x-gm@example.test', 'general_manager', 'COMPANY', companyA],
      ['g1x-bm@example.test', 'branch_manager', 'BRANCH', branch],
    ] as const) {
      const cookie = await h.signedInOperator(email);
      const userId = await (
        async () => {
          const [row] = await h.owner`SELECT id FROM "user" WHERE email = ${email}`;
          return (row?.['id'] as string) ?? '';
        }
      )();
      await addSystemRoleMember(companyA, userId, roleCode, scopeType, scopeId);
      expect((await invite(cookie, companyA, body)).status).toBe(403);
    }
  });

  it('an owner with a covering DENY override gets 403', async () => {
    const denyOwner = { email: 'g1x-deny-owner@example.test', cookie: '', userId: '' };
    denyOwner.cookie = await h.signedInOperator(denyOwner.email);
    const [row] = await h.owner`SELECT id FROM "user" WHERE email = ${denyOwner.email}`;
    denyOwner.userId = (row?.['id'] as string) ?? '';
    const companyC = await h.onboard(denyOwner.cookie, 'G1X Company C');
    const [membership] = await h.owner`
      SELECT id FROM memberships WHERE company_id = ${companyC} AND user_id = ${denyOwner.userId}
        AND role_id = ${OWNER_ROLE_ID}::uuid`;
    await h.owner`
      INSERT INTO permission_overrides (company_id, id, membership_id, permission_code, effect,
        scope_type, scope_id, reason, granted_by)
      VALUES (${companyC}, ${ids.newId()}, ${membership?.['id']},
        'manage:memberships:company', 'DENY', 'COMPANY', ${companyC}, 'test', ${denyOwner.userId})`;
    const response = await invite(denyOwner.cookie, companyC, bodyFor(companyC, 'denied@example.test'));
    expect(response.status).toBe(403);
  });
});

describe('P1-a — completion re-checks authority after an interrupted request', () => {
  it('a demoted owner resuming a pending invitation gets 403 and no membership is written', async () => {
    const company = await h.onboard(ownerA.cookie, 'G1X Company A6');
    await addSecondOwner(company, ownerA2);
    const database = h.app.get(DATABASE);
    const transactions = createMemberInvitationTransactions(database, ids);
    const emailHash = h.auth.members.hashEmail('resume403@example.test');
    const opened = await transactions.open({
      companyId: company,
      actorUserId: ownerA.userId,
      invitationId: ids.newId(),
      emailHash,
      roleCode: 'accountant',
      scope: { type: 'COMPANY', id: company },
      now: systemClock.now(),
    });
    if (!('invitationId' in opened)) throw new Error('open should have succeeded');
    // انقطاع بعد الفتح: الحساب اتعمل على pospay_auth (بالتشغيل الحقيقي) والصف PENDING بلا عضوية.
    const [userRow] = await h.owner`
      INSERT INTO "user" (id, name, email, invited_by_company_id, invitation_operation_id)
      VALUES (${ids.newId()}, 'Resumed', 'resume403@example.test', ${company}, ${opened.invitationId})
      RETURNING id`;
    // المالك اتشال من السلطة بين الانقطاع والإعادة: DENY تغطي صلاحية الدعوة.
    const [ownerMembership] = await h.owner`
      SELECT id FROM memberships WHERE company_id = ${company} AND user_id = ${ownerA.userId}
        AND role_id = ${OWNER_ROLE_ID}::uuid`;
    await h.owner`
      INSERT INTO permission_overrides (company_id, id, membership_id, permission_code, effect,
        scope_type, scope_id, reason, granted_by)
      VALUES (${company}, ${ids.newId()}, ${ownerMembership?.['id']},
        'manage:memberships:company', 'DENY', 'COMPANY', ${company}, 'test', ${ownerA.userId})`;
    const outcome = await transactions.complete({
      companyId: company,
      actorUserId: ownerA.userId,
      invitationId: opened.invitationId,
      membershipId: ids.newId(),
      userId: String(userRow?.['id']),
      buildEvent: () => {
        throw new Error('event must not be built on refusal');
      },
      buildAudit: () => {
        throw new Error('audit must not be built on refusal');
      },
      now: systemClock.now(),
    });
    expect(outcome).toEqual({ done: false, refusal: 'FORBIDDEN' });
    expect(
      await h.owner`
        SELECT count(*)::int AS n FROM memberships WHERE company_id = ${company}
          AND user_id = ${String(userRow?.['id'])}`,
    ).toEqual([{ n: 0 }]);
  });
});

describe('AC-G1-4 / P1-b — a raced invitation with different roles keeps one membership, the winner role', () => {
  it('two owners inviting the same email with different roles produce one membership and one event', async () => {
    const companyA = await h.onboard(ownerA.cookie, 'G1X Company A7');
    await addSecondOwner(companyA, ownerA2);
    const raced = (role: string) => ({
      email: 'raced@example.test',
      name: 'Raced',
      role,
      scope: { type: 'COMPANY', id: companyA },
      email_confirmed: true,
    });
    const [first, second] = await Promise.all([
      invite(ownerA.cookie, companyA, raced('accountant')),
      invite(ownerA2.cookie, companyA, raced('general_manager')),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const winnerRole = first.status === 201 ? 'accountant' : 'general_manager';
    const [row] = await h.owner`
      SELECT m.role_id, i.role_code FROM memberships m
      JOIN member_invitations i ON i.company_id = m.company_id AND i.membership_id = m.id
      WHERE m.company_id = ${companyA} AND m.user_id <> ${ownerA.userId} AND m.user_id <> ${ownerA2.userId}`;
    expect(row?.['role_code']).toBe(winnerRole);
    expect(
      await h.owner`
        SELECT count(*)::int AS n FROM outbox WHERE company_id = ${companyA}
          AND event_type = 'MemberInvited'`,
    ).toEqual([{ n: 1 }]);
  });
});

describe('AC-G1-5 — scope and role refusals', () => {
  const foreignOwner = { email: 'g1x-owner-b@example.test', cookie: '' };
  beforeAll(async () => {
    foreignOwner.cookie = await h.signedInOperator(foreignOwner.email);
  });

  it('a matching role with a business of ANOTHER company is 422 (the foreign-scope check)', async () => {
    const companyA = await h.onboard(ownerA.cookie, 'G1X Company A9');
    const companyB = await h.onboard(foreignOwner.cookie, 'G1X Company B9');
    const foreignBusiness = ids.newId();
    await h.owner`
      INSERT INTO businesses (company_id, id, name_en, vertical_type)
      VALUES (${companyB}, ${foreignBusiness}, 'G1X foreign business', 'salon')`;
    const response = await invite(ownerA.cookie, companyA, {
      email: 'foreign-scope@example.test',
      name: 'Foreign',
      role: 'business_manager',
      scope: { type: 'BUSINESS', id: foreignBusiness },
      email_confirmed: true,
    });
    expect([response.status, errorEnvelope.parse(response.body).code]).toEqual([
      422,
      'MEMBER_ROLE_NOT_INVITABLE',
    ]);
  });

  it('a role/scope mismatch is 422, and the owner role is refused by the schema as 400 (ruling)', async () => {
    const companyA = await h.onboard(ownerA.cookie, 'G1X Company A10');
    const mismatch = await invite(ownerA.cookie, companyA, {
      email: 'mismatch@example.test',
      name: 'Mismatch',
      role: 'branch_manager',
      scope: { type: 'COMPANY', id: companyA },
      email_confirmed: true,
    });
    expect([mismatch.status, errorEnvelope.parse(mismatch.body).code]).toEqual([
      422,
      'MEMBER_ROLE_NOT_INVITABLE',
    ]);
    const ownerRole = await invite(ownerA.cookie, companyA, {
      email: 'owner-role@example.test',
      name: 'Owner Role',
      role: 'owner',
      scope: { type: 'COMPANY', id: companyA },
      email_confirmed: true,
    });
    expect(ownerRole.status).toBe(400);
    expect(errorEnvelope.parse(ownerRole.body).code).toBe('VALIDATION_FAILED');
    expect(
      await h.owner`SELECT count(*)::int AS n FROM member_invitations WHERE company_id = ${companyA}`,
    ).toEqual([{ n: 0 }]);
  });
});

/** مالك تاني لشركة تانية للنطاق الأجنبي — مستخدم مستقل عن الملكين الأساسيين. */
describe('P1-d — two companies racing on one email end with 422, never 500', () => {
  it('the loser of the account-creation race is refused with MEMBER_EMAIL_NOT_INVITABLE', async () => {
    const companyA = await h.onboard(ownerA.cookie, 'G1X Race A');
    const loser = { email: 'g1x-race-loser@example.test', cookie: '' };
    loser.cookie = await h.signedInOperator(loser.email);
    const companyB = await h.onboard(loser.cookie, 'G1X Race B');
    const [first, second] = await Promise.all([
      invite(ownerA.cookie, companyA, bodyFor(companyA, 'race500@example.test')),
      invite(loser.cookie, companyB, bodyFor(companyB, 'race500@example.test')),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 422]);
    const failed = first.status === 422 ? first : second;
    expect(errorEnvelope.parse(failed.body).code).toBe('MEMBER_EMAIL_NOT_INVITABLE');
    expect(
      await h.owner`SELECT count(*)::int AS n FROM "user" WHERE email = 'race500@example.test'`,
    ).toEqual([{ n: 1 }]);
  });
});
