import { errorEnvelope } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { createAccessReader } from '../persistence/access-reader.ts';
import { AuthorizeRequest } from '../use-cases/authorize-request/authorize-request.ts';

// استثناءات الصلاحية المضمّنة (FR-080-7): كتابة على العضوية المطابقة للنطاق، استبدال
// نفس المفتاح، والتراجع الكامل عن العضويات والحساب والحدث لو استثناء اترفض.
let h: Harness;
let ownerCounter = 0;

beforeAll(async () => {
  h = await startHarness({ staffAccessRoutes: true });
});
afterAll(async () => {
  await h?.close();
});

async function setupCompany(label: string) {
  ownerCounter += 1;
  const email = `g1-ovr-${label}-${ownerCounter}@example.test`;
  const cookie = await h.signedInOperator(email);
  const company = await h.onboard(cookie, `G1 Override ${label}`);
  const [b1] = await h.owner`
    INSERT INTO businesses (company_id, id, name_en, vertical_type)
    VALUES (${company}, gen_random_uuid(), 'Override Biz 1', 'salon') RETURNING id`;
  const [b2] = await h.owner`
    INSERT INTO businesses (company_id, id, name_en, vertical_type)
    VALUES (${company}, gen_random_uuid(), 'Override Biz 2', 'salon') RETURNING id`;
  const [br1] = await h.owner`
    INSERT INTO branches (company_id, id, business_id, name_en)
    VALUES (${company}, gen_random_uuid(), ${b1?.['id']}, 'Branch 1') RETURNING id`;
  const [br2] = await h.owner`
    INSERT INTO branches (company_id, id, business_id, name_en)
    VALUES (${company}, gen_random_uuid(), ${b2?.['id']}, 'Branch 2') RETURNING id`;
  return {
    cookie,
    company,
    businessId: String(b1?.['id']),
    secondBusinessId: String(b2?.['id']),
    branchId: String(br1?.['id']),
    secondBranchId: String(br2?.['id']),
  };
}

const overrideInput = (
  scopeType: 'COMPANY' | 'BUSINESS' | 'BRANCH',
  scopeId: string,
  permissionCode: string,
  effect: 'ALLOW' | 'DENY',
  reason: string,
) => ({
  permission_code: permissionCode,
  effect,
  scope_type: scopeType,
  scope_id: scopeId,
  reason,
  expires_at: null,
});

const hasBranchPermission = (
  userId: string,
  company: string,
  branchId: string,
  permission: string,
) =>
  new AuthorizeRequest(createAccessReader(h.app.get(DATABASE))).execute({
    userId,
    requestedCompany: company,
    permission,
    branchParam: branchId,
  });

const hasBusinessPermission = (
  userId: string,
  company: string,
  businessId: string,
  permission: string,
) =>
  new AuthorizeRequest(createAccessReader(h.app.get(DATABASE))).execute({
    userId,
    requestedCompany: company,
    permission,
    businessParam: businessId,
  });

it('FR-080-7 happy path: writes inline override onto matching membership and enforces it immediately', async () => {
  const { cookie, company, businessId, secondBusinessId } = await setupCompany('happy');
  const response = await h.send('POST', '/v1/memberships/invitations', {
    cookie,
    company,
    body: {
      email: 'override-happy@example.test',
      name: 'Override Happy',
      role: 'business_manager',
      scope: { type: 'BUSINESS', id: businessId },
      email_confirmed: true,
      additional_roles: [{ role: 'business_manager', scope: { type: 'BUSINESS', id: secondBusinessId } }],
      permission_overrides: [
        overrideInput('BUSINESS', secondBusinessId, 'read:memberships:business', 'ALLOW', 'launch desk coverage'),
      ],
    },
  });
  expect(response.status).toBe(201);

  const [invited] = await h.owner`SELECT id FROM "user" WHERE email = 'override-happy@example.test'`;
  const userId = String(invited?.['id']);
  const memberships = await h.owner`
    SELECT id, scope_id FROM memberships WHERE company_id = ${company} AND user_id = ${userId}`;
  const secondMembership = memberships.find((row) => row['scope_id'] === secondBusinessId);
  expect(
    await h.owner`SELECT membership_id, permission_code, effect FROM permission_overrides WHERE company_id = ${company}`,
  ).toEqual([
    {
      membership_id: secondMembership?.['id'],
      permission_code: 'read:memberships:business',
      effect: 'ALLOW',
    },
  ]);
  expect(
    await h.owner`SELECT action FROM audit_log WHERE company_id = ${company} AND entity = 'permission_override'`,
  ).toEqual([{ action: 'permission.granted' }]);
  expect(
    await hasBusinessPermission(userId, company, secondBusinessId, 'read:memberships:business'),
  ).not.toBeNull();
  expect(
    await hasBusinessPermission(userId, company, businessId, 'read:memberships:business'),
  ).toBeNull();
});

it('FR-080-7 replace path: expires an earlier override on the same key and audits permission.replaced', async () => {
  const { cookie, company, branchId } = await setupCompany('replace');
  const response = await h.send('POST', '/v1/memberships/invitations', {
    cookie,
    company,
    body: {
      email: 'override-replace@example.test',
      name: 'Override Replace',
      role: 'branch_manager',
      scope: { type: 'BRANCH', id: branchId },
      email_confirmed: true,
      permission_overrides: [
        overrideInput('BRANCH', branchId, 'create:customers:branch', 'ALLOW', 'initial grant'),
        overrideInput('BRANCH', branchId, 'create:customers:branch', 'DENY', 'superseded in same invite'),
      ],
    },
  });
  expect(response.status).toBe(201);
  expect(
    await h.owner`SELECT effect, (expires_at IS NOT NULL) AS expired
      FROM permission_overrides WHERE company_id = ${company} ORDER BY id`,
  ).toEqual([
    { effect: 'ALLOW', expired: true },
    { effect: 'DENY', expired: false },
  ]);
  const audit = await h.owner`
    SELECT action FROM audit_log WHERE company_id = ${company} AND entity = 'permission_override' ORDER BY id`;
  expect(audit.map((row) => row['action'])).toEqual(['permission.granted', 'permission.replaced']);
  const [invited] = await h.owner`SELECT id FROM "user" WHERE email = 'override-replace@example.test'`;
  expect(await hasBranchPermission(String(invited?.['id']), company, branchId, 'create:customers:branch')).toBeNull();
});

it('FR-080-7 refusal rollback: rolls back memberships, overrides, outbox and user on refused override', async () => {
  const { cookie, company, branchId, secondBranchId } = await setupCompany('refused');
  const response = await h.send('POST', '/v1/memberships/invitations', {
    cookie,
    company,
    body: {
      email: 'override-refused@example.test',
      name: 'Override Refused',
      role: 'branch_manager',
      scope: { type: 'BRANCH', id: branchId },
      email_confirmed: true,
      additional_roles: [{ role: 'branch_manager', scope: { type: 'BRANCH', id: secondBranchId } }],
      permission_overrides: [
        overrideInput('COMPANY', company, 'manage:memberships:company', 'ALLOW', 'forbidden for role'),
      ],
    },
  });
  expect([response.status, errorEnvelope.parse(response.body).code]).toEqual([
    403,
    'PERMISSION_ROLE_FORBIDDEN',
  ]);
  expect(await h.owner`SELECT count(*)::int AS n FROM memberships WHERE company_id = ${company}`).toEqual([
    { n: 1 },
  ]);
  expect(
    await h.owner`SELECT count(*)::int AS n FROM permission_overrides WHERE company_id = ${company}`,
  ).toEqual([{ n: 0 }]);
  expect(
    await h.owner`SELECT count(*)::int AS n FROM outbox WHERE company_id = ${company} AND event_type = 'MemberInvited'`,
  ).toEqual([{ n: 0 }]);
  expect(
    await h.owner`SELECT count(*)::int AS n FROM member_invitations WHERE company_id = ${company} AND membership_id IS NOT NULL`,
  ).toEqual([{ n: 0 }]);
  expect(await h.owner`SELECT id FROM "user" WHERE email = 'override-refused@example.test'`).toHaveLength(
    0,
  );
});
