import { errorEnvelope } from '@pospay/contracts';
import { OWNER_ROLE_ID, SYSTEM_ROLES, type TenantWrappers } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMemberInvitationTransactions } from '../persistence/member-invitation-transactions.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { systemClock } from '../../../shared/adapters/system-clock.ts';

// سلطة الدعوة (AC-G1-4، P1-a): مالك كانوني بس، والفحص بيتعيد جوه معاملة الإتمام ومسار
// إعادة الإصدار؛ والسباق على نفس الإيميل بأدوار مختلفة بيسيب عضوية واحدة بدور الفايز (P1-b).
// وحجز الرابط الأول بيعيد فحص نفس السلطة جوه معاملته (AC-ACT-19).
const ids = systemUuidV7();
let h: Harness;
// برج بين فتح الدعوة وإتمامها: بعد ما معاملة الفتح تكوميت بيفعّل الخطّاف مرة واحدة (P1-a).
let betweenSteps: (() => Promise<void>) | null = null;
// برج تاني بعد ما العضوية تتكتب وقبل حجز الرابط: صف الدعوة بقى له عضوية ولسه ما اتحجزش (AC-ACT-19).
let beforeClaim: (() => Promise<void>) | null = null;
const withBarrier = (db: TenantWrappers): TenantWrappers => ({
  ...db,
  withTenant: async (companyId, work, options) => {
    const result = await db.withTenant(companyId, work, options);
    const hook = betweenSteps;
    if (hook !== null) {
      const [pending] = await h.owner`
        SELECT 1 FROM member_invitations WHERE company_id = ${companyId} AND membership_id IS NULL`;
      if (pending !== undefined) {
        betweenSteps = null;
        await hook();
      }
    }
    const claimHook = beforeClaim;
    if (claimHook !== null) {
      const [written] = await h.owner`
        SELECT 1 FROM member_invitations WHERE company_id = ${companyId} AND membership_id IS NOT NULL AND link_claimed_at IS NULL`;
      if (written !== undefined) {
        beforeClaim = null;
        await claimHook();
      }
    }
    return result;
  },
});
const ownerA = { email: 'g1x-owner-a@example.test', cookie: '', userId: '' };
const ownerA2 = { email: 'g1x-owner-a2@example.test', cookie: '', userId: '' };

const role = (code: string) => SYSTEM_ROLES.find((r) => r.code === code)?.id ?? '';

beforeAll(async () => {
  h = await startHarness({ staffAccessRoutes: true, wrapDatabase: withBarrier });
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
      const userId = await (async () => {
        const [row] = await h.owner`SELECT id FROM "user" WHERE email = ${email}`;
        return (row?.['id'] as string) ?? '';
      })();
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
    const response = await invite(
      denyOwner.cookie,
      companyC,
      bodyFor(companyC, 'denied@example.test'),
    );
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
      additionalAssignments: [],
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
      additionalAssignments: [],
      additionalMembershipIds: [],
      permissionOverrides: [],
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

const denyInvitations = async (company: string, userId: string) => {
  const [membership] = await h.owner`
    SELECT id FROM memberships WHERE company_id = ${company} AND user_id = ${userId}
      AND role_id = ${OWNER_ROLE_ID}::uuid`;
  await h.owner`
    INSERT INTO permission_overrides (company_id, id, membership_id, permission_code, effect,
      scope_type, scope_id, reason, granted_by)
    VALUES (${company}, ${ids.newId()}, ${membership?.['id']},
      'manage:memberships:company', 'DENY', 'COMPANY', ${company}, 'test', ${userId})`;
  return String(membership?.['id']);
};

describe('P1-a — the barrier between open and complete inside ONE request', () => {
  it('an owner who loses authority between the two steps gets 403 and no membership or event', async () => {
    const company = await h.onboard(ownerA.cookie, 'G1X Barrier Authority');
    betweenSteps = async () => {
      await denyInvitations(company, ownerA.userId);
    };
    const response = await invite(
      ownerA.cookie,
      company,
      bodyFor(company, 'barrier-authority@example.test'),
    );
    betweenSteps = null;
    expect([response.status, errorEnvelope.parse(response.body).code]).toEqual([403, 'FORBIDDEN']);
    expect(
      await h.owner`SELECT count(*)::int AS n FROM memberships WHERE company_id = ${company}`,
    ).toEqual([{ n: 1 }]);
    expect(
      await h.owner`SELECT count(*)::int AS n FROM outbox WHERE company_id = ${company} AND event_type = 'MemberInvited'`,
    ).toEqual([{ n: 0 }]);
  });

  it('a branch removed between the two steps makes the completion refuse 422 and write nothing', async () => {
    const company = await h.onboard(ownerA.cookie, 'G1X Barrier Scope');
    const { branch } = await addBusinessAndBranch(company);
    betweenSteps = async () => {
      await h.owner`DELETE FROM branches WHERE company_id = ${company} AND id = ${branch}`;
    };
    const response = await invite(ownerA.cookie, company, {
      ...bodyFor(company, 'barrier-scope@example.test'),
      role: 'branch_manager',
      scope: { type: 'BRANCH', id: branch },
    });
    betweenSteps = null;
    expect([response.status, errorEnvelope.parse(response.body).code]).toEqual([
      422,
      'MEMBER_ROLE_NOT_INVITABLE',
    ]);
    expect(
      await h.owner`SELECT count(*)::int AS n FROM memberships WHERE company_id = ${company}`,
    ).toEqual([{ n: 1 }]);
  });
});

describe('AC-ACT-19 — the first link claim re-checks the owner', () => {
  it('an owner who loses authority after the membership commits gets 403 and the link stays unclaimed', async () => {
    const company = await h.onboard(ownerA2.cookie, 'G1X Claim Authority');
    // السلطة بتتسلب بعد ما العضوية تتكتب وقبل ما الرابط يتحجز: DENY على صلاحية الدعوة.
    beforeClaim = async () => {
      await denyInvitations(company, ownerA2.userId);
    };
    const response = await invite(
      ownerA2.cookie,
      company,
      bodyFor(company, 'claim-authority@example.test'),
    );
    beforeClaim = null;
    expect([response.status, errorEnvelope.parse(response.body).code]).toEqual([403, 'FORBIDDEN']);
    expect(response.body['set_password_link']).toBeUndefined();
    expect(
      await h.owner`SELECT link_claimed_at IS NULL AS unclaimed FROM member_invitations
        WHERE company_id = ${company}`,
    ).toEqual([{ unclaimed: true }]);
  });
});

describe('P1-a — re-issue re-checks authority and scope in its own transaction', () => {
  it('a scope that no longer belongs to the company is refused 422 and an owner carrying a DENY is refused FORBIDDEN', async () => {
    const company = await h.onboard(ownerA.cookie, 'G1X Reissue Authority');
    const { branch } = await addBusinessAndBranch(company);
    const created = await invite(ownerA.cookie, company, {
      ...bodyFor(company, 'reissue-authority@example.test'),
      role: 'branch_manager',
      scope: { type: 'BRANCH', id: branch },
    });
    expect(created.status).toBe(201);
    const transactions = createMemberInvitationTransactions(h.app.get(DATABASE), ids);
    const request = {
      companyId: company,
      actorUserId: ownerA.userId,
      invitationId: String(created.body['invitation_id']),
    };
    expect(await transactions.claimReissue(request)).toMatchObject({ userId: expect.any(String) });
    // العضوية بتمنع حذف الفرع (FK)، فنفس الحالة بتتحاكى بصف دعوة نطاقه ما بقاش تابع للشركة.
    await h.owner`UPDATE member_invitations SET scope_id = ${ids.newId()}
      WHERE company_id = ${company} AND id = ${request.invitationId}`;
    expect(await transactions.claimReissue(request)).toEqual({
      refusal: 'MEMBER_ROLE_NOT_INVITABLE',
    });
    await denyInvitations(company, ownerA.userId);
    expect(await transactions.claimReissue(request)).toEqual({ refusal: 'FORBIDDEN' });
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
    expect(row?.['role_id']).toBe(role(winnerRole));
    const events = await h.owner`
      SELECT payload FROM outbox WHERE company_id = ${companyA} AND event_type = 'MemberInvited'`;
    expect(events).toHaveLength(1);
    expect(events[0]?.['payload']).toMatchObject({ role_code: winnerRole });
  });
});

describe('P1-b — a pending row is never mutated by a later request', () => {
  it('the same owner re-sending the email with another role gets 409 and the row keeps its role', async () => {
    const company = await h.onboard(ownerA.cookie, 'G1X Fixed Row');
    const first = await invite(ownerA.cookie, company, bodyFor(company, 'fixed-row@example.test'));
    expect(first.status).toBe(201);
    const second = await invite(ownerA.cookie, company, {
      ...bodyFor(company, 'fixed-row@example.test'),
      role: 'general_manager',
    });
    expect([second.status, errorEnvelope.parse(second.body).code]).toEqual([
      409,
      'MEMBER_INVITATION_EXISTS',
    ]);
    const [row] = await h.owner`
      SELECT role_code, invited_by FROM member_invitations WHERE company_id = ${company}`;
    expect(row).toEqual({ role_code: 'accountant', invited_by: ownerA.userId });
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
    for (const outOfList of ['owner', 'cashier']) {
      const refused = await invite(ownerA.cookie, companyA, {
        ...bodyFor(companyA, `${outOfList}-role@example.test`),
        role: outOfList,
      });
      expect([refused.status, errorEnvelope.parse(refused.body).code]).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
    }
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
