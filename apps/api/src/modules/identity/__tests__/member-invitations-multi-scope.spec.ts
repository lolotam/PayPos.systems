import { errorEnvelope } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

// دعوة متعددة النطاقات (080): أدوار increase، أكتر من فرع — كلها في معاملة واحدة، وأي رفض
// بيرجّع الدعوة كلها.
const ORIGIN = 'http://admin.test';
let h: Harness;
let ownerCounter = 0;

beforeAll(async () => {
  h = await startHarness({ staffAccessRoutes: true });
});
afterAll(async () => {
  await h?.close();
});

/** مالك جديد بحدّه: حد الدعوات عشرة في الساعة لكل مالك. */
async function freshOwner(label: string) {
  ownerCounter += 1;
  const email = `g1-multi-${label}-${ownerCounter}@example.test`;
  const cookie = await h.signedInOperator(email);
  const [row] = await h.owner`SELECT id FROM "user" WHERE email = ${email}`;
  return { email, cookie, userId: String(row?.['id']) };
}

/** نشاطين وفرعين في الشركة: الفرع التاني هو اللي بيت targeting للاستثناء. */
async function companyWithTwoBranches(company: string) {
  const business = await h.owner`
    INSERT INTO businesses (company_id, id, name_en, vertical_type)
    VALUES (${company}, gen_random_uuid(), 'Multi business', 'salon') RETURNING id`;
  const other = await h.owner`
    INSERT INTO businesses (company_id, id, name_en, vertical_type)
    VALUES (${company}, gen_random_uuid(), 'Second business', 'salon') RETURNING id`;
  const branch = await h.owner`
    INSERT INTO branches (company_id, id, business_id, name_en)
    VALUES (${company}, gen_random_uuid(), ${business?.[0]?.['id']}, 'First branch') RETURNING id`;
  const second = await h.owner`
    INSERT INTO branches (company_id, id, business_id, name_en)
    VALUES (${company}, gen_random_uuid(), ${other?.[0]?.['id']}, 'Second branch') RETURNING id`;
  return {
    businessId: String(business?.[0]?.['id']),
    otherBusinessId: String(other?.[0]?.['id']),
    branchId: String(branch?.[0]?.['id']),
    secondBranchId: String(second?.[0]?.['id']),
  };
}

const invite = (cookie: string, company: string, body: object) =>
  h.send('POST', '/v1/memberships/invitations', { cookie, company, body });

const codeOf = (response: { status: number; body: Record<string, unknown> }) => [
  response.status,
  errorEnvelope.parse(response.body).code,
];

/** العضويات اللي اتكتبت للعضو المدعوّ. */
async function membershipsOf(company: string, email: string) {
  const [invited] = await h.owner`SELECT id FROM "user" WHERE email = ${email}`;
  return h.owner`SELECT id, scope_type, scope_id, role_id FROM memberships
    WHERE company_id = ${company} AND user_id = ${String(invited?.['id'])} ORDER BY scope_id`;
}

/** ينضم العضو المدعوّ فعلياً: يغيّر كلمة المرور ويسجّل دخول. */
async function signInInvited(link: string, email: string, password: string) {
  const token = new URL(link).pathname.split('/').pop() ?? '';
  await h.app.inject({
    method: 'POST',
    url: '/v1/auth/reset-password',
    headers: { origin: ORIGIN },
    payload: { token, newPassword: password },
  });
  const signedIn = await h.app.inject({
    method: 'POST',
    url: '/v1/auth/sign-in/email',
    headers: { origin: ORIGIN },
    payload: { email, password },
  });
  const cookies = signedIn.headers['set-cookie'];
  return (Array.isArray(cookies) ? cookies : [cookies ?? ''])
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

/** الفروع اللي شايفين العضو في مساحات العمل. */
async function workspaceBranches(cookie: string) {
  const workspaces = await h.send('GET', '/v1/me/workspaces', { cookie });
  expect(workspaces.status).toBe(200);
  const companies = workspaces.body['companies'] as {
    businesses: { branches: { id: string }[] }[];
  }[];
  return companies
    .flatMap((entry) => entry.businesses.flatMap((business) => business.branches))
    .map((branch) => branch.id);
}

describe('FR-080-1 — one invitation, several memberships in the same company', () => {
  it('writes the primary and the extra branch atomically, and both reach the workspaces', async () => {
    const owner = await freshOwner('branches');
    const company = await h.onboard(owner.cookie, 'G1 Multi Branches');
    const scope = await companyWithTwoBranches(company);
    const response = await invite(owner.cookie, company, {
      email: 'multi-branch@example.test',
      name: 'Multi',
      role: 'branch_manager',
      scope: { type: 'BRANCH', id: scope.branchId },
      email_confirmed: true,
      additional_roles: [
        { role: 'branch_manager', scope: { type: 'BRANCH', id: scope.secondBranchId } },
      ],
    });
    expect(response.status).toBe(201);

    const memberships = await membershipsOf(company, 'multi-branch@example.test');
    expect(memberships).toHaveLength(2);
    expect(memberships.map((row) => row['scope_id']).sort()).toEqual(
      [scope.branchId, scope.secondBranchId].sort(),
    );
    const branchManager = SYSTEM_ROLES.find((role) => role.code === 'branch_manager')?.id;
    for (const membership of memberships) {
      expect(membership).toMatchObject({ scope_type: 'BRANCH', role_id: branchManager });
    }
    const audit = await h.owner`
      SELECT entity, action FROM audit_log WHERE company_id = ${company} AND entity = 'membership'`;
    expect(audit).toHaveLength(2);
    const events = await h.owner`
      SELECT payload FROM outbox WHERE company_id = ${company} AND event_type = 'MemberInvited'`;
    expect(events).toHaveLength(2);

    const cookie = await signInInvited(
      response.body['set_password_link'] as string,
      'multi-branch@example.test',
      'multi-chosen-pass',
    );
    expect((await workspaceBranches(cookie)).sort()).toEqual(
      [scope.branchId, scope.secondBranchId].sort(),
    );
  });

  it('drops an extra role that repeats the primary assignment', async () => {
    const owner = await freshOwner('duplicate');
    const company = await h.onboard(owner.cookie, 'G1 Multi Duplicate');
    const scope = await companyWithTwoBranches(company);
    const response = await invite(owner.cookie, company, {
      email: 'multi-duplicate@example.test',
      name: 'Multi',
      role: 'branch_manager',
      scope: { type: 'BRANCH', id: scope.branchId },
      email_confirmed: true,
      additional_roles: [
        { role: 'branch_manager', scope: { type: 'BRANCH', id: scope.branchId } },
      ],
    });
    expect(response.status).toBe(201);
    expect(await membershipsOf(company, 'multi-duplicate@example.test')).toHaveLength(1);
  });
});

describe('FR-080-2 — every extra scope belongs to the same company', () => {
  it('refuses an extra branch from another company before anything is written', async () => {
    const owner = await freshOwner('foreign');
    const company = await h.onboard(owner.cookie, 'G1 Multi Foreign');
    const other = await h.onboard(owner.cookie, 'G1 Multi Foreign Other');
    const scope = await companyWithTwoBranches(company);
    const foreign = await companyWithTwoBranches(other);
    const response = await invite(owner.cookie, company, {
      email: 'multi-foreign@example.test',
      name: 'Multi',
      role: 'branch_manager',
      scope: { type: 'BRANCH', id: scope.branchId },
      email_confirmed: true,
      additional_roles: [
        { role: 'branch_manager', scope: { type: 'BRANCH', id: foreign.branchId } },
      ],
    });
    expect(codeOf(response)).toEqual([422, 'MEMBER_ROLE_NOT_INVITABLE']);
    expect(
      await h.owner`SELECT count(*)::int AS n FROM memberships WHERE company_id = ${company}`,
    ).toEqual([{ n: 1 }]);
    expect(
      await h.owner`SELECT id FROM "user" WHERE email = 'multi-foreign@example.test'`,
    ).toHaveLength(0);
  });

  it('refuses an extra COMPANY role from another company before anything is written', async () => {
    const owner = await freshOwner('foreign-company');
    const company = await h.onboard(owner.cookie, 'G1 Multi Foreign Company');
    const other = await h.onboard(owner.cookie, 'G1 Multi Foreign Company Other');
    const response = await invite(owner.cookie, company, {
      email: 'multi-foreign-company@example.test',
      name: 'Multi',
      role: 'general_manager',
      scope: { type: 'COMPANY', id: company },
      email_confirmed: true,
      additional_roles: [{ role: 'accountant', scope: { type: 'COMPANY', id: other } }],
    });
    expect(codeOf(response)).toEqual([422, 'MEMBER_ROLE_NOT_INVITABLE']);
    expect(
      await h.owner`SELECT count(*)::int AS n FROM memberships WHERE company_id = ${company}`,
    ).toEqual([{ n: 1 }]);
    expect(
      await h.owner`SELECT id FROM "user" WHERE email = 'multi-foreign-company@example.test'`,
    ).toHaveLength(0);
  });
});

describe('the single-role payload keeps working exactly as before', () => {
  it('writes one membership, one audit row and one link', async () => {
    const owner = await freshOwner('plain');
    const company = await h.onboard(owner.cookie, 'G1 Multi Plain');
    const response = await invite(owner.cookie, company, {
      email: 'multi-plain@example.test',
      name: 'Multi',
      role: 'accountant',
      scope: { type: 'COMPANY', id: company },
      email_confirmed: true,
    });
    expect(response.status).toBe(201);
    expect(await membershipsOf(company, 'multi-plain@example.test')).toHaveLength(1);
    const audit = await h.owner`
      SELECT entity, action FROM audit_log WHERE company_id = ${company}
        AND (entity = 'member_invitation' OR entity = 'membership') ORDER BY entity`;
    expect(audit.map((row) => `${row['entity']}:${row['action']}`).sort()).toEqual([
      'member_invitation:invite.opened',
      'member_invitation:link.issued',
      'member_invitation:user.created',
      'membership:created',
    ]);
  });
});
