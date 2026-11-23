import { createPlatformUser } from '@pospay/auth';
import { errorEnvelope } from '@pospay/contracts';
import { OWNER_ROLE_ID, SYSTEM_ROLES } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

// دعوة عضو (076 G1) عبر المسارات الحقيقية: مالك الشركة بس، والرابط مرة واحدة، والعمر 48 ساعة
// (IM-Q3). كل اختبار مُشمول على AC من spec §4 G1 بالاسم.
const ids = systemUuidV7();
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
  ownerA.cookie = await h.signedInOperator(ownerA.email);
  ownerA.userId = await userIdByEmail(ownerA.email);
  ownerB.cookie = await h.signedInOperator(ownerB.email);
  ownerB.userId = await userIdByEmail(ownerB.email);
});

function captureChunk(chunk: unknown, _encoding: string, callback: () => void): void {
  chunks.push(chunk as Buffer);
  callback();
}

afterAll(async () => {
  await h?.close();
});

async function userIdByEmail(email: string): Promise<string> {
  const [row] = await h.owner`SELECT id FROM "user" WHERE email = ${email}`;
  return (row?.['id'] as string) ?? '';
}

const invite = (cookie: string, company: string, body: object) =>
  h.send('POST', '/v1/memberships/invitations', { cookie, company, body });

const tokenOf = (link: string) => new URL(link).pathname.split('/').pop() ?? '';

const resetPassword = (token: string, newPassword: string) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/auth/reset-password',
    headers: { origin: 'http://admin.test' },
    payload: { token, newPassword },
  });

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

describe('AC-G1-1 — inviting an accountant creates the user, the membership and a one-time link', () => {
  it('answers 201 once with the link, then never returns it again', async () => {
    const companyA = await h.onboard(ownerA.cookie, 'G1 Company A1');
    const response = await invite(ownerA.cookie, companyA, {
      email: 'ahmed@example.test',
      name: 'Ahmed',
      role: 'accountant',
      scope: { type: 'COMPANY', id: companyA },
      email_confirmed: true,
    });
    expect(response.status).toBe(201);
    const link = response.body['set_password_link'] as string;
    const invitationId = response.body['invitation_id'] as string;
    expect(link).toContain('/v1/auth/reset-password/');
    expect(link).toContain(`callbackURL=${encodeURIComponent('http://admin.test/set-password')}`);
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
    // الرابط بيفتح صفحة تعيين كلمة المرور (PR #1252) والاستهلاك فيه POST /reset-password.
    expect((await resetPassword(tokenOf(link), 'ahmed-chosen-pass')).statusCode).toBe(200);
    const list = await h.send('GET', '/v1/memberships/invitations', {
      cookie: ownerA.cookie,
      company: companyA,
    });
    expect(list.status).toBe(200);
    for (const row of list.body['items'] as Record<string, unknown>[]) {
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
    expect(Buffer.concat(chunks).toString('utf8')).not.toContain(tokenOf(link));
  });
});

describe('AC-G1-2 — the link dies after one use and after 48 hours; the operator link stays one hour', () => {
  it('consumes once, refuses a replay, and refuses an expired link', async () => {
    const companyA = await h.onboard(ownerA.cookie, 'G1 Company A2');
    const invited = await invite(ownerA.cookie, companyA, {
      email: 'expiry@example.test',
      name: 'Expiry',
      role: 'accountant',
      scope: { type: 'COMPANY', id: companyA },
      email_confirmed: true,
    });
    const token = tokenOf(invited.body['set_password_link'] as string);
    expect((await resetPassword(token, 'expiry-chosen-pass')).statusCode).toBe(200);
    expect((await resetPassword(token, 'expiry-chosen-pass-2')).statusCode).toBe(400);
    const expired = await invite(ownerA.cookie, companyA, {
      email: 'expired@example.test',
      name: 'Expired',
      role: 'accountant',
      scope: { type: 'COMPANY', id: companyA },
      email_confirmed: true,
    });
    const expiredToken = tokenOf(expired.body['set_password_link'] as string);
    await h.owner`
      UPDATE verification SET expires_at = now() - interval '1 second'
      WHERE identifier = ${`reset-password:${expiredToken}`}`;
    expect((await resetPassword(expiredToken, 'expired-chosen-pass')).statusCode).toBe(400);
  });

  it('an operator-created link still lasts exactly one hour', async () => {
    const { userId } = await createPlatformUser(h.auth, {
      email: 'g1-operator-hour@example.test',
      name: 'Operator',
      operator: 'waleed',
      redirectTo: 'http://admin.test/set-password',
    });
    const [row] = await h.owner`
      SELECT EXTRACT(epoch FROM (expires_at - created_at))::int AS seconds FROM verification
      WHERE value = ${userId}`;
    expect(row?.['seconds']).toBe(3600);
  });
});

describe('AC-G1-3 — an existing account gets only the membership, and the confirmation is mandatory', () => {
  it('adds the membership with no link for an existing account', async () => {
    const companyA = await h.onboard(ownerA.cookie, 'G1 Company A3');
    const response = await invite(ownerA.cookie, companyA, {
      email: ownerB.email,
      name: 'Owner B',
      role: 'accountant',
      scope: { type: 'COMPANY', id: companyA },
      email_confirmed: true,
    });
    expect(response.status).toBe(201);
    expect(response.body['set_password_link']).toBeNull();
    expect(
      await h.owner`
        SELECT 1 FROM memberships WHERE company_id = ${companyA} AND user_id = ${ownerB.userId}`,
    ).toHaveLength(1);
  });

  it('rejects the request without the confirmation tick, before any write', async () => {
    const companyA = await h.onboard(ownerA.cookie, 'G1 Company A4');
    for (const confirmation of [{}, { email_confirmed: false }]) {
      const response = await invite(ownerA.cookie, companyA, {
        email: 'unconfirmed@example.test',
        name: 'Unconfirmed',
        role: 'accountant',
        scope: { type: 'COMPANY', id: companyA },
        ...confirmation,
      });
      expect(response.status).toBe(400);
      expect(errorEnvelope.parse(response.body).code).toBe('VALIDATION_FAILED');
    }
    expect(await h.owner`SELECT 1 FROM "user" WHERE email = 'unconfirmed@example.test'`).toHaveLength(
      0,
    );
  });
});

/** مالك تالت عنده DENY تغطي صلاحية الدعوة على شركته كلها — الرفض جاي من فحص السلطة جوه المعاملة. */
async function ownerWithCoveringDeny(name: string, email: string) {
  const cookie = await h.signedInOperator(email);
  const company = await h.onboard(cookie, name);
  const userId = await userIdByEmail(email);
  const [membership] = await h.owner`
    SELECT id FROM memberships WHERE company_id = ${company} AND user_id = ${userId}
      AND role_id = ${OWNER_ROLE_ID}::uuid`;
  await h.owner`
    INSERT INTO permission_overrides (company_id, id, membership_id, permission_code, effect,
      scope_type, scope_id, reason, granted_by)
    VALUES (${company}, ${ids.newId()}, ${membership?.['id']},
      'manage:memberships:company', 'DENY', 'COMPANY', ${company}, 'test', ${userId})`;
  return { cookie, company };
}

describe('AC-G1-4 — authority is the canonical owner inside the transaction', () => {
  it('a general manager, a branch manager and an owner with a covering DENY get 403', async () => {
    const companyA = await h.onboard(ownerA.cookie, 'G1 Company A5');
    const { branch } = await addBusinessAndBranch(companyA);
    const body = {
      email: 'forbidden@example.test',
      name: 'Forbidden',
      role: 'accountant',
      scope: { type: 'COMPANY', id: companyA },
      email_confirmed: true,
    };
    for (const [email, roleCode, scopeType, scopeId] of [
      ['g1-gm@example.test', 'general_manager', 'COMPANY', companyA],
      ['g1-bm@example.test', 'branch_manager', 'BRANCH', branch],
    ] as const) {
      const cookie = await h.signedInOperator(email);
      const userId = await userIdByEmail(email);
      await addSystemRoleMember(companyA, userId, roleCode, scopeType, scopeId);
      expect((await invite(cookie, companyA, body)).status).toBe(403);
    }
    const denied = await ownerWithCoveringDeny('G1 Company C', 'g1-deny-owner@example.test');
    expect(
      (
        await invite(denied.cookie, denied.company, {
          ...body,
          scope: { type: 'COMPANY', id: denied.company },
        })
      ).status,
    ).toBe(403);
  });
});

describe('AC-G1-4 — self-invitation and a raced invitation', () => {
  it('the owner inviting his own email is refused', async () => {
    const companyA = await h.onboard(ownerA.cookie, 'G1 Company A6');
    const response = await invite(ownerA.cookie, companyA, {
      email: ownerA.email,
      name: 'Self',
      role: 'accountant',
      scope: { type: 'COMPANY', id: companyA },
      email_confirmed: true,
    });
    expect([response.status, errorEnvelope.parse(response.body).code]).toEqual([
      422,
      'MEMBER_EMAIL_NOT_INVITABLE',
    ]);
  });

  it('two owners inviting the same email at once produce one membership and one event', async () => {
    const companyA = await h.onboard(ownerA.cookie, 'G1 Company A7');
    const secondOwner = { email: 'g1-owner-a2@example.test', cookie: '' };
    secondOwner.cookie = await h.signedInOperator(secondOwner.email);
    const secondUserId = await userIdByEmail(secondOwner.email);
    await addSystemRoleMember(companyA, secondUserId, 'owner', 'COMPANY', companyA);
    const body = {
      email: 'raced@example.test',
      name: 'Raced',
      role: 'accountant',
      scope: { type: 'COMPANY', id: companyA },
      email_confirmed: true,
    };
    const [first, second] = await Promise.all([
      invite(ownerA.cookie, companyA, body),
      invite(secondOwner.cookie, companyA, body),
    ]);
    // السباق بيتقفل بأحد شكلين: خاسر واحد 409، أو التاني بيستأنف نفس الدعوة 201 بنفس المعرف.
    // الثابت في الحالتين: عضوية واحدة، حدث واحد، والرابط ما بيظهرش مرتين.
    const statuses = [first.status, second.status];
    expect(statuses.every((status) => status === 201 || status === 409)).toBe(true);
    expect(statuses).toContain(201);
    if (statuses.every((status) => status === 201)) {
      expect(first.body['invitation_id']).toBe(second.body['invitation_id']);
      const withLink = [first, second].filter(
        (response) => response.body['set_password_link'] !== null,
      );
      expect(withLink).toHaveLength(1);
    }
    expect(
      await h.owner`
        SELECT count(*)::int AS n FROM memberships WHERE company_id = ${companyA}
          AND user_id <> ${ownerA.userId} AND user_id <> ${secondUserId}`,
    ).toEqual([{ n: 1 }]);
    expect(
      await h.owner`
        SELECT count(*)::int AS n FROM outbox WHERE company_id = ${companyA}
          AND event_type = 'MemberInvited'`,
    ).toEqual([{ n: 1 }]);
  });
});

describe('AC-G1-5 — a role/scope mismatch is refused with MEMBER_ROLE_NOT_INVITABLE', () => {
  // مالك مخصص للتو Gruppe دي: حدّ الدعوات لكل مالك عشر في الساعة، فكل مجموعة اختبارات ليها مالكها.
  const mismatchOwner = { email: 'g1-owner-mismatch@example.test', cookie: '' };
  let companyM: string;
  beforeAll(async () => {
    mismatchOwner.cookie = await h.signedInOperator(mismatchOwner.email);
    companyM = await h.onboard(mismatchOwner.cookie, 'G1 Company M');
  });

  it.each([
    ['branch_manager', 'COMPANY'],
    ['accountant', 'BUSINESS'],
  ])('%j with a %j scope is 422', async (roleCode, scopeType) => {
    const response = await invite(mismatchOwner.cookie, companyM, {
      email: `mismatch-${roleCode}-${scopeType}@example.test`,
      name: 'Mismatch',
      role: roleCode,
      scope: { type: scopeType, id: companyM },
      email_confirmed: true,
    });
    expect([response.status, errorEnvelope.parse(response.body).code]).toEqual([
      422,
      'MEMBER_ROLE_NOT_INVITABLE',
    ]);
  });

  it('a scope that belongs to another company is 422, and a role outside the list is refused by the schema', async () => {
    const companyB = await h.onboard(ownerB.cookie, 'G1 Company B1');
    const { business } = await addBusinessAndBranch(companyB);
    const foreignScope = await invite(mismatchOwner.cookie, companyM, {
      email: 'foreign-scope@example.test',
      name: 'Foreign',
      role: 'accountant',
      scope: { type: 'BUSINESS', id: business },
      email_confirmed: true,
    });
    expect([foreignScope.status, errorEnvelope.parse(foreignScope.body).code]).toEqual([
      422,
      'MEMBER_ROLE_NOT_INVITABLE',
    ]);
    const ownerRole = await invite(mismatchOwner.cookie, companyM, {
      email: 'owner-role@example.test',
      name: 'Owner Role',
      role: 'owner',
      scope: { type: 'COMPANY', id: companyM },
      email_confirmed: true,
    });
    expect(ownerRole.status).toBe(400);
    expect(errorEnvelope.parse(ownerRole.body).code).toBe('VALIDATION_FAILED');
    expect(
      await h.owner`SELECT count(*)::int AS n FROM member_invitations WHERE company_id = ${companyM}`,
    ).toEqual([{ n: 0 }]);
  });
});
