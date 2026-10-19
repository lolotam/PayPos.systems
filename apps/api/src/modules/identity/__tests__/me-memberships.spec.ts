import {
  errorEnvelope,
  myMembershipsResponse,
  type MyMembershipsResponse,
} from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

let h: Harness;
let ownerCookie: string;
let managerCookie: string;
let companyA: string;
let companyB: string;
let businessId: string;
let branchId: string;
let managerId: string;
let ownerMembershipId: string;
let branchMembershipId: string;
let businessMembershipId: string;
let foreignMembershipId: string;

function roleId(code: string): string {
  const found = SYSTEM_ROLES.find((role) => role.code === code);
  if (found === undefined) throw new Error(`missing role ${code}`);
  return found.id;
}

async function userId(email: string): Promise<string> {
  const [row] = await h.owner`SELECT id FROM "user" WHERE email = ${email}`;
  if (row === undefined || typeof row['id'] !== 'string') throw new Error(`no user ${email}`);
  return row['id'];
}

async function grant(input: {
  company: string;
  user: string;
  scope: 'COMPANY' | 'BUSINESS' | 'BRANCH';
  scopeId: string;
  role: string;
  starts?: string;
  ends?: string;
}): Promise<string> {
  const id = randomUUID();
  const starts = input.starts ?? new Date(Date.now() - 60_000).toISOString();
  await h.owner`
    INSERT INTO memberships (
      company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, starts_at, ends_at
    ) VALUES (
      ${input.company}, ${id}, ${input.user}, ${input.role}, 'global',
      ${input.scope}, ${input.scopeId}, ${starts}::timestamptz, ${input.ends ?? null}
    )`;
  return id;
}

async function buildTree(): Promise<void> {
  const business = await h.send('POST', '/v1/businesses', {
    cookie: ownerCookie,
    company: companyA,
    key: 'me-mem-business',
    body: { vertical_type: 'retail', name_en: 'Clinic' },
  });
  expect(business.status).toBe(201);
  if (typeof business.body['id'] !== 'string') throw new Error('business has no id');
  businessId = business.body['id'];
  const branch = await h.send('POST', `/v1/businesses/${businessId}/branches`, {
    cookie: ownerCookie,
    company: companyA,
    key: 'me-mem-branch',
    body: { name_en: 'Salmiya' },
  });
  expect(branch.status).toBe(201);
  if (typeof branch.body['id'] !== 'string') throw new Error('branch has no id');
  branchId = branch.body['id'];
}

async function list(cookie: string, company: string): Promise<MyMembershipsResponse> {
  const res = await h.send('GET', '/v1/me/memberships', { cookie, company });
  expect(res.status).toBe(200);
  return myMembershipsResponse.parse(res.body);
}

const json = (
  method: 'GET' | 'POST',
  url: string,
  body?: object,
  headers: Record<string, string> = {},
) => h.app.inject({ method, url, headers, ...(body === undefined ? {} : { payload: body }) });

async function deviceToken(): Promise<string> {
  const pairing = await h.send('POST', `/v1/branches/${branchId}/devices/pairing-code`, {
    cookie: ownerCookie,
    company: companyA,
  });
  expect(pairing.status).toBe(201);
  const registered = await json('POST', '/v1/devices/register', {
    pairing_code: pairing.body['code'],
    label: 'Cancel till',
  });
  expect(registered.statusCode).toBe(201);
  const device = registered.json() as {
    company_id: string;
    device_id: string;
    claim_secret: string;
  };
  expect(
    (
      await h.send('POST', `/v1/branches/${branchId}/devices/${device.device_id}/approve`, {
        cookie: ownerCookie,
        company: companyA,
      })
    ).status,
  ).toBe(204);
  const claimed = await json('POST', '/v1/devices/claim', device);
  expect(claimed.statusCode).toBe(200);
  return (claimed.json() as { device_token: string }).device_token;
}

beforeAll(async () => {
  h = await startHarness();
  ownerCookie = await h.signedInOperator('me-memberships-owner@example.test');
  managerCookie = await h.signedInOperator('me-memberships-manager@example.test');
  const otherCookie = await h.signedInOperator('me-memberships-other@example.test');
  companyA = await h.onboard(ownerCookie, 'Alpha Co');
  companyB = await h.onboard(otherCookie, 'Beta Co');
  await buildTree();
  managerId = await userId('me-memberships-manager@example.test');
  const ownerId = await userId('me-memberships-owner@example.test');
  const [ownerRow] = await h.owner`
    SELECT id FROM memberships WHERE company_id = ${companyA} AND user_id = ${ownerId}`;
  if (ownerRow === undefined || typeof ownerRow['id'] !== 'string')
    throw new Error('no owner membership');
  ownerMembershipId = ownerRow['id'];
  branchMembershipId = await grant({
    company: companyA,
    user: managerId,
    scope: 'BRANCH',
    scopeId: branchId,
    role: roleId('branch_manager'),
  });
  businessMembershipId = await grant({
    company: companyA,
    user: managerId,
    scope: 'BUSINESS',
    scopeId: businessId,
    role: roleId('business_manager'),
  });
  foreignMembershipId = await grant({
    company: companyB,
    user: managerId,
    scope: 'COMPANY',
    scopeId: companyB,
    role: roleId('viewer'),
  });
  await grant({
    company: companyA,
    user: managerId,
    scope: 'BRANCH',
    scopeId: branchId,
    role: roleId('cashier'),
    starts: '2020-01-01T00:00:00Z',
    ends: '2020-02-01T00:00:00Z',
  });
}, 120_000);

afterAll(async () => {
  await h.close();
});

async function managerSeesOwnNames(): Promise<void> {
  const denied = await h.send('GET', '/v1/permissions/memberships', {
    cookie: managerCookie,
    company: companyA,
  });
  expect(denied.status).toBe(403);
  const body = await list(managerCookie, companyA);
  const byId = new Map(body.items.map((membership) => [membership.id, membership]));
  expect([...byId.keys()].sort()).toEqual([branchMembershipId, businessMembershipId].sort());
  expect(byId.get(branchMembershipId)).toEqual({
    id: branchMembershipId,
    role_code: 'branch_manager',
    role_is_system: true,
    role_name_ar: null,
    role_name_en: 'Branch Manager',
    scope_type: 'BRANCH',
    scope_id: branchId,
    scope_name_ar: null,
    scope_name_en: 'Salmiya',
  });
  expect(byId.get(businessMembershipId)).toMatchObject({
    role_code: 'business_manager',
    role_is_system: true,
    role_name_en: 'Business Manager',
    scope_type: 'BUSINESS',
    scope_id: businessId,
    scope_name_en: 'Clinic',
  });
  expect(JSON.stringify(body)).not.toContain(ownerMembershipId);
  expect(JSON.stringify(body)).not.toContain(foreignMembershipId);
  expect(body.items[0]).not.toHaveProperty('user_id');
}

async function headerSelectsCompany(): Promise<void> {
  const body = await list(managerCookie, companyB);
  expect(body.items.map((membership) => membership.id)).toEqual([foreignMembershipId]);
  expect(body.items[0]).toMatchObject({
    scope_type: 'COMPANY',
    scope_id: companyB,
    scope_name_en: 'Beta Co',
    role_code: 'viewer',
  });
  expect(JSON.stringify(body)).not.toContain(branchMembershipId);
  expect(JSON.stringify(body)).not.toContain(companyA);
}

async function deviceIsForbidden(): Promise<void> {
  const token = await deviceToken();
  const res = await h.app.inject({
    method: 'GET',
    url: '/v1/me/memberships',
    headers: { authorization: `Device ${token}`, 'x-company-id': companyA },
  });
  expect(res.statusCode).toBe(403);
  expect(errorEnvelope.parse(res.json()).code).toBe('FORBIDDEN');
}

async function anonymousAndMissingHeader(): Promise<void> {
  const anonymous = await h.app.inject({
    method: 'GET',
    url: '/v1/me/memberships',
    headers: { 'x-company-id': companyA },
  });
  expect(anonymous.statusCode).toBe(401);
  expect(errorEnvelope.parse(anonymous.json()).code).toBe('UNAUTHENTICATED');
  expect((await h.send('GET', '/v1/me/memberships', { cookie: managerCookie })).status).toBe(400);
}

async function uppercaseHeaderMatches(): Promise<void> {
  const lower = await list(managerCookie, companyA);
  const upper = await list(managerCookie, companyA.toUpperCase());
  expect(upper.items.map((membership) => membership.id).sort()).toEqual(
    lower.items.map((membership) => membership.id).sort(),
  );
  expect(upper.items.length).toBeGreaterThan(0);
}

describe('GET /v1/me/memberships', () => {
  it('gives a manager without read:memberships:company their own role and scope names', () =>
    managerSeesOwnNames());

  it('never returns another company when the header names this one', () => headerSelectsCompany());

  it('refuses a device principal the same way workspaces does', () => deviceIsForbidden());

  it('refuses a missing session and a missing company header', () => anonymousAndMissingHeader());

  it('accepts an uppercase company header', () => uppercaseHeaderMatches());
});
