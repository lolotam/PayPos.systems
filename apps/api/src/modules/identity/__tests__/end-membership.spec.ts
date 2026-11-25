import { errorEnvelope } from '@pospay/contracts';
import { OWNER_ROLE_ID, SYSTEM_ROLES } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { systemClock } from '../../../shared/adapters/system-clock.ts';
import { ApiError } from '../../../shared/errors.ts';
import { createEndMembershipTransactions } from '../persistence/end-membership-transactions.ts';
import { createGrantInvalidator } from '../persistence/grant-invalidator.ts';
import { EndMembership } from '../use-cases/end-membership/end-membership.ts';

// إنهاء العضوية (AC-G2-1): مالك كانوني بس، آخر مالك محمي بتريجر 0013 عند الـ commit (409 مش 500)،
// وجلسات الدخول بكلمة المرور ما بتتلمسش — العضو يفضل شغال في شركاته التانية.
const ids = systemUuidV7();
let closed: Harness;
let h: Harness;
const ownerA = { email: 'g2-owner-a@example.test', cookie: '', userId: '' };
const ownerB = { email: 'g2-owner-b@example.test', cookie: '', userId: '' };

const role = (code: string) => SYSTEM_ROLES.find((r) => r.code === code)?.id ?? '';
const userIdOf = async (email: string): Promise<string> => {
  const [row] = await h.owner`SELECT id FROM "user" WHERE email = ${email}`;
  return (row?.['id'] as string) ?? '';
};

beforeAll(async () => {
  closed = await startHarness({});
  h = await startHarness({ staffAccessRoutes: true });
  for (const who of [ownerA, ownerB]) {
    who.cookie = await h.signedInOperator(who.email);
    who.userId = await userIdOf(who.email);
  }
});

afterAll(async () => {
  await Promise.all([closed?.close(), h?.close()]);
});

const addMember = async (
  company: string,
  userId: string,
  roleCode: string,
  scopeType: string,
  scopeId: string,
): Promise<string> => {
  const id = ids.newId();
  await h.owner`
    INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
    VALUES (${company}, ${id}, ${userId}, ${role(roleCode)}, 'global', ${scopeType}, ${scopeId})`;
  return id;
};

const addBranch = async (company: string): Promise<string> => {
  const business = ids.newId();
  const branch = ids.newId();
  await h.owner`
    INSERT INTO businesses (company_id, id, name_en, vertical_type)
    VALUES (${company}, ${business}, 'G2 business', 'salon')`;
  await h.owner`
    INSERT INTO branches (company_id, id, business_id, name_en)
    VALUES (${company}, ${branch}, ${business}, 'G2 branch')`;
  return branch;
};

const endedAt = async (membershipId: string): Promise<unknown> => {
  const [row] = await h.owner`SELECT ends_at FROM memberships WHERE id = ${membershipId}`;
  return row?.['ends_at'];
};

const end = (harness: Harness, cookie: string, company: string, membershipId: string) =>
  harness.send('POST', `/v1/memberships/${membershipId}/end`, { cookie, company });

const ownerMembershipOf = async (company: string, userId: string): Promise<string> => {
  const [row] = await h.owner`
    SELECT id FROM memberships WHERE company_id = ${company} AND user_id = ${userId}
      AND role_id = ${OWNER_ROLE_ID}::uuid`;
  return (row?.['id'] as string) ?? '';
};

describe('AC-G2-1 (1) the activation gate', () => {
  const url = '/v1/memberships/01920000-0000-7000-8000-0000000000d1/end';

  it('answers 503 NOT_READY before auth and before body parsing, signed in or not', async () => {
    const cookie = await closed.signedInOperator('g2-gate@example.test');
    for (const headers of [{}, { cookie }]) {
      const bare = await closed.app.inject({ method: 'POST', url, headers });
      expect(bare.statusCode).toBe(503);
      expect(errorEnvelope.parse(bare.json()).code).toBe('NOT_READY');
      const broken = await closed.app.inject({
        method: 'POST',
        url,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: '{"broken"',
      });
      expect(broken.statusCode).toBe(503);
      expect(errorEnvelope.parse(broken.json()).code).toBe('NOT_READY');
    }
  });

  it('with the gate open and no session it answers 401', async () => {
    expect((await h.app.inject({ method: 'POST', url })).statusCode).toBe(401);
  });
});

describe('AC-G2-1 (2) authority: only the canonical owner', () => {
  it('a general manager, a branch manager and an owner with a covering DENY get 403 and nothing ends', async () => {
    const company = await h.onboard(ownerA.cookie, 'G2 Company Authority');
    const branch = await addBranch(company);
    const target = await addMember(
      company,
      await userIdOf(ownerB.email),
      'accountant',
      'COMPANY',
      company,
    );
    for (const [email, roleCode, scopeType, scopeId] of [
      ['g2-gm@example.test', 'general_manager', 'COMPANY', company],
      ['g2-bm@example.test', 'branch_manager', 'BRANCH', branch],
    ] as const) {
      const cookie = await h.signedInOperator(email);
      await addMember(company, await userIdOf(email), roleCode, scopeType, scopeId);
      expect((await end(h, cookie, company, target)).status).toBe(403);
    }
    const denied = { email: 'g2-deny-owner@example.test', cookie: '', userId: '' };
    denied.cookie = await h.signedInOperator(denied.email);
    denied.userId = await userIdOf(denied.email);
    const deniedCompany = await h.onboard(denied.cookie, 'G2 Company Deny');
    const deniedTarget = await addMember(
      deniedCompany,
      ownerA.userId,
      'accountant',
      'COMPANY',
      deniedCompany,
    );
    await h.owner`
      INSERT INTO permission_overrides (company_id, id, membership_id, permission_code, effect,
        scope_type, scope_id, reason, granted_by)
      VALUES (${deniedCompany}, ${ids.newId()}, ${await ownerMembershipOf(deniedCompany, denied.userId)},
        'manage:memberships:company', 'DENY', 'COMPANY', ${deniedCompany}, 'test', ${denied.userId})`;
    expect((await end(h, denied.cookie, deniedCompany, deniedTarget)).status).toBe(403);
    expect(await endedAt(target)).toBeNull();
    expect(await endedAt(deniedTarget)).toBeNull();
  });
});

describe('AC-G2-1 (3) the owner ends a member', () => {
  it('answers { id, ends_at }, audits, bumps the grant version, refuses the member in that company only', async () => {
    const memberEmail = 'g2-accountant@example.test';
    const memberCookie = await h.signedInOperator(memberEmail);
    const memberId = await userIdOf(memberEmail);
    const company = await h.onboard(ownerA.cookie, 'G2 Company End');
    const second = await h.onboard(memberCookie, 'G2 Member Own Company');
    const membership = await addMember(company, memberId, 'accountant', 'COMPANY', company);
    expect((await h.send('GET', '/v1/businesses', { cookie: memberCookie, company })).status).toBe(
      200,
    );

    const response = await end(h, ownerA.cookie, company, membership);

    expect(response.status).toBe(200);
    expect(response.body['id']).toBe(membership);
    expect(typeof response.body['ends_at']).toBe('string');
    expect(await endedAt(membership)).not.toBeNull();
    expect(
      await h.owner`
        SELECT actor_user_id, before, after FROM audit_log
        WHERE company_id = ${company} AND action = 'membership.ended' AND entity_id = ${membership}`,
    ).toEqual([
      {
        actor_user_id: ownerA.userId,
        before: { ends_at: null },
        after: { ends_at: response.body['ends_at'] },
      },
    ]);
    expect((await h.send('GET', '/v1/businesses', { cookie: memberCookie, company })).status).toBe(
      403,
    );
    expect(
      (await h.send('GET', '/v1/businesses', { cookie: memberCookie, company: second })).status,
    ).toBe(200);
  });

  it('answers the same ends_at again without a second audit row', async () => {
    const company = await h.onboard(ownerA.cookie, 'G2 Company Twice');
    const membership = await addMember(company, ownerB.userId, 'accountant', 'COMPANY', company);
    const first = await end(h, ownerA.cookie, company, membership);
    const again = await end(h, ownerA.cookie, company, membership);
    expect(again.status).toBe(200);
    expect(again.body['ends_at']).toEqual(first.body['ends_at']);
    expect(
      await h.owner`SELECT 1 FROM audit_log WHERE company_id = ${company} AND action = 'membership.ended'`,
    ).toHaveLength(1);
  });
});

describe('AC-G2-1 (4) the last owner', () => {
  it('answers 409 LAST_OWNER (not 500) and the owner stays active', async () => {
    const company = await h.onboard(ownerA.cookie, 'G2 Company Last');
    const own = await ownerMembershipOf(company, ownerA.userId);
    const response = await end(h, ownerA.cookie, company, own);
    expect(response.status).toBe(409);
    expect(errorEnvelope.parse(response.body).code).toBe('LAST_OWNER');
    expect(await endedAt(own)).toBeNull();
    expect(
      await h.owner`SELECT 1 FROM audit_log WHERE company_id = ${company} AND action = 'membership.ended'`,
    ).toHaveLength(0);
  });
});

describe('AC-G2-1 (5) two owners ending each other at a real barrier', () => {
  it('one commits, the other is refused LAST_OWNER, exactly one owner stays active', async () => {
    const company = await h.onboard(ownerA.cookie, 'G2 Company Race');
    const m1 = await ownerMembershipOf(company, ownerA.userId);
    const m2 = await addMember(company, ownerB.userId, 'owner', 'COMPANY', company);
    let arrived = 0;
    let release!: () => void;
    const both = new Promise<void>((done) => {
      release = done;
    });
    const atBarrier = async () => {
      arrived += 1;
      if (arrived === 2) release();
      await both;
    };
    const build = () =>
      new EndMembership({
        transactions: createEndMembershipTransactions(h.app.get(DATABASE), ids, atBarrier),
        invalidator: createGrantInvalidator(h.redis),
        clock: systemClock,
      });
    const settle = (work: Promise<unknown>) =>
      work
        .then(
          () => 'ok' as const,
          (error: unknown) => (error instanceof ApiError ? error.code : 'unexpected'),
        )
        .finally(release);

    const results = await Promise.all([
      settle(build().execute({ companyId: company, actorUserId: ownerA.userId, membershipId: m2 })),
      settle(build().execute({ companyId: company, actorUserId: ownerB.userId, membershipId: m1 })),
    ]);

    expect(arrived).toBe(2);
    expect([...results].sort()).toEqual(['LAST_OWNER', 'ok']);
    expect(
      await h.owner`
        SELECT id FROM memberships WHERE company_id = ${company}
          AND role_id = ${OWNER_ROLE_ID}::uuid AND ends_at IS NULL`,
    ).toHaveLength(1);
  });
});

describe('AC-G2-1 (6) a foreign company membership', () => {
  it('answers 404 NOT_FOUND and leaves the foreign row untouched', async () => {
    const mine = await h.onboard(ownerA.cookie, 'G2 Company Mine');
    const theirs = await h.onboard(ownerB.cookie, 'G2 Company Theirs');
    const foreign = await addMember(theirs, ownerA.userId, 'accountant', 'COMPANY', theirs);
    const response = await end(h, ownerA.cookie, mine, foreign);
    expect(response.status).toBe(404);
    expect(errorEnvelope.parse(response.body).code).toBe('NOT_FOUND');
    expect(await endedAt(foreign)).toBeNull();
  });
});

describe('AC-G2-1 (7) a membership managed by employee staff access', () => {
  it('answers 409 STAFF_ACCESS_MANAGED_MEMBERSHIP and keeps the membership active', async () => {
    const company = await h.onboard(ownerA.cookie, 'G2 Company Staff Access');
    const business = ids.newId();
    const branch = ids.newId();
    const employee = ids.newId();
    const staffUser = ids.newId();
    await h.owner`
      INSERT INTO businesses (company_id, id, name_en, vertical_type)
      VALUES (${company}, ${business}, 'G2 business', 'salon')`;
    await h.owner`
      INSERT INTO branches (company_id, id, business_id, name_en)
      VALUES (${company}, ${branch}, ${business}, 'G2 branch')`;
    await h.owner`
      INSERT INTO "user" (id, name, email)
      VALUES (${staffUser}, 'G2 Staff User', ${`${staffUser}@example.test`})`;
    const membership = await addMember(company, staffUser, 'staff', 'BRANCH', branch);
    await h.owner`
      INSERT INTO employees (company_id, id, business_id, primary_branch_id, user_id, name_en, name_en_key, role_code, hire_date, employee_number)
      VALUES (${company}, ${employee}, ${business}, ${branch}, ${staffUser}, 'G2 Staff', 'g2 staff', 'staff', '2026-01-01', 1)`;
    await h.owner`
      INSERT INTO employee_staff_access (company_id, id, business_id, employee_id, operation_id, role_code, branch_id, state, granted_by, phone_hash, attempt_id, user_id, membership_id)
      VALUES (${company}, ${ids.newId()}, ${business}, ${employee}, ${ids.newId()}, 'staff', ${branch}, 'ACTIVE', ${ownerA.userId}, ${'a'.repeat(64)}, ${ids.newId()}, ${staffUser}, ${membership})`;

    const response = await end(h, ownerA.cookie, company, membership);

    expect(response.status).toBe(409);
    expect(errorEnvelope.parse(response.body).code).toBe('STAFF_ACCESS_MANAGED_MEMBERSHIP');
    expect(await endedAt(membership)).toBeNull();
    expect(
      await h.owner`SELECT 1 FROM audit_log WHERE company_id = ${company} AND action = 'membership.ended'`,
    ).toHaveLength(0);
  });
});

describe('AC-G2-1 (8) a membership scheduled to end in the future', () => {
  it('ends it immediately and records the prior ends_at in the audit before-image', async () => {
    const company = await h.onboard(ownerA.cookie, 'G2 Company Future End');
    const membership = await addMember(company, ownerB.userId, 'accountant', 'COMPANY', company);
    const futureEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await h.owner`
      UPDATE memberships SET ends_at = ${futureEndsAt}::timestamptz
      WHERE company_id = ${company} AND id = ${membership}`;

    const beforeCall = Date.now();
    const response = await end(h, ownerA.cookie, company, membership);

    expect(response.status).toBe(200);
    const actualEndsAt = Date.parse(String(response.body['ends_at']));
    expect(actualEndsAt).toBeLessThanOrEqual(Date.now() + 1000);
    expect(actualEndsAt).toBeGreaterThanOrEqual(beforeCall - 1000);
    const ended = (await endedAt(membership)) as string | Date;
    expect(new Date(ended).toISOString()).toBe(response.body['ends_at']);
    expect(
      await h.owner`
        SELECT actor_user_id, before, after FROM audit_log
        WHERE company_id = ${company} AND action = 'membership.ended' AND entity_id = ${membership}`,
    ).toEqual([
      {
        actor_user_id: ownerA.userId,
        before: { ends_at: new Date(futureEndsAt).toISOString() },
        after: { ends_at: response.body['ends_at'] },
      },
    ]);
  });
});
