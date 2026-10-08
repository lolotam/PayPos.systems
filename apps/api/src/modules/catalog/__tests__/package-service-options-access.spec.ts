import { packageServiceOptionPage, packageTypeDetail } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { packageTypesFixture, packageTerms, type PackageFixture } from './package-types.fixture.ts';

const ids = systemUuidV7();
let f: PackageFixture;
let roleId: string;
beforeAll(async () => {
  f = await packageTypesFixture();
  const [member] = await f.h
    .owner`UPDATE memberships SET scope_type='BUSINESS',scope_id=${f.business}
    WHERE company_id=${f.company} AND id=${f.memberId} RETURNING role_id`;
  roleId = member?.['role_id'] as string;
});
beforeEach(async () => {
  await f.h
    .owner`DELETE FROM role_permissions WHERE role_owner_key=${f.company} AND role_id=${roleId}`;
  await f.h
    .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.memberId}`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const request = (
  suffix = '/package-types/service-options',
  business = f.business,
  company = f.company,
) =>
  f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${business}${suffix}`,
    headers: { cookie: f.cookie, 'x-company-id': company },
  });
const grant = (permission: string) => f.h.owner`INSERT INTO role_permissions
  (company_id,role_id,role_owner_key,permission_code) VALUES (${f.company},${roleId},${f.company},${permission})`;

it('a custom package manager with package read but no service read loads options and creates a package', async () => {
  await grant('manage:package-types:business');
  await grant('read:package-types:business');
  expect((await request('/services')).statusCode).toBe(403);
  expect((await request('/package-types')).statusCode).toBe(200);
  const options = await request();
  expect(options.statusCode).toBe(200);
  const option = packageServiceOptionPage.parse(options.json()).items[0];
  expect(option).toEqual({
    id: f.services[0]?.id,
    name_en: 'Service 0',
    name_ar: null,
    price: '0.000',
    active: true,
  });
  const created = await f.h.app.inject({
    method: 'POST',
    url: `/v1/businesses/${f.business}/package-types`,
    headers: { cookie: f.cookie, 'x-company-id': f.company },
    payload: { ...packageTerms(f), components: [{ service_id: option?.id, sessions: 10 }] },
  });
  expect(created.statusCode).toBe(201);
  expect(packageTypeDetail.parse(created.json()).components[0]?.service_id).toBe(option?.id);
});

it('read:package-types alone can load options even if manage is explicitly denied', async () => {
  await grant('read:package-types:business');
  await f.h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${f.company},${ids.newId()},${f.memberId},'manage:package-types:business','DENY',
      'BUSINESS',${f.business},'Synthetic denial',${f.userId})`;
  expect((await request()).statusCode).toBe(200);
  expect((await request('/services')).statusCode).toBe(403);
});

it('missing package read, including service-only and manage-only roles, gets the normal package refusal', async () => {
  for (const permission of [null, 'read:services:business', 'manage:package-types:business']) {
    if (permission) await grant(permission);
    const response = await request();
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual((await request('/package-types')).json());
  }
});

it('a DENY on package read cannot fall back to manage or service permission', async () => {
  await grant('manage:package-types:business');
  await grant('read:package-types:business');
  await grant('read:services:business');
  await f.h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${f.company},${ids.newId()},${f.memberId},'read:package-types:business','DENY',
      'BUSINESS',${f.business},'Synthetic denial',${f.userId})`;
  expect((await request()).statusCode).toBe(403);
});

it('foreign, unknown and out-of-scope businesses have the same refusal as package routes', async () => {
  await grant('manage:package-types:business');
  await grant('read:package-types:business');
  const expected = (await request('/package-types', ids.newId())).json();
  for (const business of [f.secondBusiness, f.foreignBusiness, ids.newId()]) {
    const response = await request('/package-types/service-options', business);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual(expected);
  }
  const unrelatedCompany = await request('/package-types/service-options', f.business, ids.newId());
  expect(unrelatedCompany.statusCode).toBe(403);
  expect(unrelatedCompany.json()).toEqual(expected);
});

it('loading options adds no audit, outbox or catalog rows', async () => {
  await grant('read:package-types:business');
  const counts = async () => f.h.owner`SELECT
    (SELECT count(*) FROM audit_log WHERE company_id=${f.company}) AS audit,
    (SELECT count(*) FROM outbox WHERE company_id=${f.company}) AS outbox,
    (SELECT count(*) FROM services WHERE company_id=${f.company}) AS services,
    (SELECT count(*) FROM package_types WHERE company_id=${f.company}) AS packages,
    (SELECT count(*) FROM package_type_components WHERE company_id=${f.company}) AS components`;
  const before = await counts();
  expect((await request()).statusCode).toBe(200);
  expect(await counts()).toEqual(before);
});
