import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  customRoleMember,
  estimateFixture,
  estimatePath,
  globalRoleMember,
  ids,
  permissionOverride,
  secondMembership,
  seedBusiness,
  seedCatalogue,
  seedEmployees,
  seedLines,
  type EstimateFixture,
} from './commission-estimate.fixture.ts';

let fixture: EstimateFixture;

beforeAll(async () => {
  fixture = await estimateFixture();
});

afterAll(async () => {
  await fixture?.h.close();
});

const get = (f: EstimateFixture, actor = f.cookie, business = f.business) =>
  f.h.send('GET', estimatePath(business), { cookie: actor, company: f.company });

const DEFAULT_ROLES = [
  { code: 'owner', scope: 'COMPANY', visible: 2 },
  { code: 'general_manager', scope: 'BUSINESS', visible: 2 },
  { code: 'business_manager', scope: 'BUSINESS', visible: 2 },
  { code: 'accountant', scope: 'BUSINESS', visible: 2 },
  { code: 'branch_manager', scope: 'BRANCH', visible: 1 },
] as const;

it.each(DEFAULT_ROLES)(
  'lets the default $code role read the estimate',
  async ({ code, scope, visible }) => {
    const member = await globalRoleMember(fixture, code, scope);
    const response = await get(fixture, member.cookie);

    expect(response.status).toBe(200);
    expect((response.body as { employees: unknown[] }).employees).toHaveLength(visible);
  },
);

it('refuses a reader with no membership in the company', async () => {
  const stranger = await fixture.h.signedInOperator(
    `commission-estimate-stranger-${ids.newId()}@example.test`,
  );
  const response = await get(fixture, stranger);

  expect(response.status).toBe(403);
  expect((response.body as { code: string }).code).toBe('FORBIDDEN');
});

it('refuses an invalid company header with a 400', async () => {
  const response = await fixture.h.send('GET', estimatePath(fixture.business), {
    cookie: fixture.cookie,
    company: fixture.company,
    headers: { 'x-company-id': 'not-a-uuid' },
  });

  expect(response.status).toBe(400);
});

it('refuses a member without the permission with the uniform 403', async () => {
  const member = await globalRoleMember(fixture, 'viewer', 'BUSINESS');
  const response = await get(fixture, member.cookie);

  expect(response.status).toBe(403);
  expect((response.body as { code: string }).code).toBe('FORBIDDEN');
});

it('refuses a device session', async () => {
  const pairing = await fixture.h.send('POST', `/v1/branches/${fixture.branch}/devices/pairing-code`, {
    cookie: fixture.cookie,
    company: fixture.company,
  });
  const registered = await fixture.h.app.inject({
    method: 'POST',
    url: '/v1/devices/register',
    payload: { pairing_code: pairing.body['code'], label: 'Estimate device' },
  });
  const device = registered.json() as { device_id: string; claim_secret: string };
  await fixture.h.send('POST', `/v1/branches/${fixture.branch}/devices/${device.device_id}/approve`, {
    cookie: fixture.cookie,
    company: fixture.company,
  });
  const claimed = await fixture.h.app.inject({
    method: 'POST',
    url: '/v1/devices/claim',
    payload: {
      company_id: fixture.company,
      device_id: device.device_id,
      claim_secret: device.claim_secret,
    },
  });
  const token = (claimed.json() as { device_token: string }).device_token;

  const response = await fixture.h.app.inject({
    method: 'GET',
    url: estimatePath(fixture.business),
    headers: { 'x-company-id': fixture.company, authorization: `Bearer ${token}` },
  });

  expect(response.statusCode).not.toBe(200);
});

it('refuses the estimate when the commissions feature is off', async () => {
  const [operator] = await fixture.h.owner`SELECT id FROM "user" LIMIT 1`;
  await fixture.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${fixture.company},'commissions',false,'estimate proof',${operator?.['id']}::uuid)`;
  const response = await get(fixture);

  expect(response.status).toBe(403);
  expect((response.body as { code: string }).code).toBe('FEATURE_DISABLED');
  await fixture.h.owner`DELETE FROM company_feature_overrides
    WHERE company_id=${fixture.company} AND flag='commissions'`;
});

it('ignores an expired permission override', async () => {
  const member = await globalRoleMember(fixture, 'viewer', 'BUSINESS');
  await permissionOverride(
    fixture,
    member.membershipId,
    'ALLOW',
    { type: 'BUSINESS', id: fixture.business },
    '2020-01-01T00:00:00Z',
  );
  const response = await get(fixture, member.cookie);

  expect(response.status).toBe(403);
});

it('lets an explicit grant open the estimate to a custom role without the default', async () => {
  const member = await customRoleMember(fixture, 'estimate_granted');
  await permissionOverride(fixture, member.membershipId, 'ALLOW', {
    type: 'BUSINESS',
    id: fixture.business,
  });
  const response = await get(fixture, member.cookie);

  expect(response.status).toBe(200);
  expect((response.body as { employees: unknown[] }).employees).toHaveLength(2);
});

it('closes the estimate again when the explicit grant is revoked', async () => {
  const member = await customRoleMember(fixture, 'estimate_revoked');
  const overrideId = await permissionOverride(fixture, member.membershipId, 'ALLOW', {
    type: 'BUSINESS',
    id: fixture.business,
  });
  expect((await get(fixture, member.cookie)).status).toBe(200);

  await fixture.h.owner`DELETE FROM permission_overrides
    WHERE company_id=${fixture.company} AND id=${overrideId}::uuid`;

  expect((await get(fixture, member.cookie)).status).toBe(403);
});

it('subtracts a branch a current DENY covers from the effective scope', async () => {
  const member = await globalRoleMember(fixture, 'branch_manager', 'BRANCH');
  await permissionOverride(fixture, member.membershipId, 'DENY', {
    type: 'BRANCH',
    id: fixture.branch,
  });
  const response = await get(fixture, member.cookie);

  expect(response.status).toBe(403);
  expect((response.body as { code: string }).code).toBe('FORBIDDEN');
});

it('subtracts a branch denied by another membership of the same reader', async () => {
  const member = await globalRoleMember(fixture, 'branch_manager', 'BRANCH');
  const other = await secondMembership(fixture, member.userId, 'viewer', 'BUSINESS');
  await permissionOverride(fixture, other, 'DENY', {
    type: 'BRANCH',
    id: fixture.branch,
  });
  const response = await get(fixture, member.cookie);

  expect(response.status).toBe(403);
  expect((response.body as { code: string }).code).toBe('FORBIDDEN');
});

it('keeps the business-wide scope for an owner whose sibling membership carries a DENY', async () => {
  // حماية المالك (ADR-0025) بتلغي DENY من العضوية الشقيقة لما تكون عضوية المالك سارية،
  // وده المتعارض المقصود مع النص المطلق في CS-Q20.
  const owner = await globalRoleMember(fixture, 'owner', 'COMPANY');
  const sibling = await secondMembership(fixture, owner.userId, 'viewer', 'BUSINESS');
  await permissionOverride(fixture, sibling, 'DENY', {
    type: 'BRANCH',
    id: fixture.branch,
  });
  const response = await get(fixture, owner.cookie);

  expect(response.status).toBe(200);
  expect((response.body as { employees: unknown[] }).employees).toHaveLength(2);
});

it('filters a business-wide holder that carries any current DENY', async () => {
  const member = await globalRoleMember(fixture, 'general_manager', 'BUSINESS');
  await permissionOverride(fixture, member.membershipId, 'DENY', {
    type: 'BRANCH',
    id: fixture.secondBranch,
  });
  const response = await get(fixture, member.cookie);

  expect(response.status).toBe(200);
  const body = response.body as { employees: { employee_id: string }[]; total: string };
  expect(body.employees.map((employee) => employee.employee_id)).toEqual([fixture.employee]);
  expect(body.total).toBe('1.000');
});

it('never shows an employee of another company', async () => {
  const other = await fixture.h.onboard(fixture.cookie, 'Other estimate employer');
  const otherBusiness = await seedBusiness(fixture.h, fixture.cookie, other, 'other-estimate');
  const otherEmployee = await seedEmployees(
    fixture.h,
    other,
    otherBusiness.business,
    otherBusiness.branch,
  );
  const otherTenant = await seedCatalogue(
    fixture.h,
    other,
    otherBusiness.business,
    otherBusiness.branch,
    otherEmployee.employee,
  );
  await seedLines(
    fixture.h,
    other,
    otherTenant,
    otherEmployee.secondEmployee,
    otherBusiness.secondBranch,
  );
  const response = await get(fixture);

  expect(response.status).toBe(200);
  const body = response.body as { employees: { employee_id: string }[] };
  expect(body.employees.map((employee) => employee.employee_id)).not.toContain(
    otherEmployee.employee,
  );
  expect(body.employees).toHaveLength(2);
});

it('never shows an employee of another business in the same company', async () => {
  const other = await seedBusiness(fixture.h, fixture.cookie, fixture.company, 'sibling-estimate');
  const otherEmployee = await seedEmployees(
    fixture.h,
    fixture.company,
    other.business,
    other.branch,
    11,
  );
  const otherTenant = await seedCatalogue(
    fixture.h,
    fixture.company,
    other.business,
    other.branch,
    otherEmployee.employee,
  );
  await seedLines(
    fixture.h,
    fixture.company,
    otherTenant,
    otherEmployee.secondEmployee,
    other.secondBranch,
  );
  const sibling = await get(fixture, fixture.cookie, other.business);
  expect(sibling.status).toBe(200);
  const siblingBody = sibling.body as { employees: { employee_id: string }[] };
  expect(siblingBody.employees.map((employee) => employee.employee_id).sort()).toEqual(
    [otherEmployee.employee, otherEmployee.secondEmployee].sort(),
  );

  const own = await get(fixture);
  const ownBody = own.body as { employees: { employee_id: string }[] };
  expect(ownBody.employees.map((employee) => employee.employee_id)).not.toContain(
    otherEmployee.employee,
  );
});
