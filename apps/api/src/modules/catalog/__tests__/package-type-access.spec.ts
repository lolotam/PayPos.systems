import { packageTypeDetail } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  packageTypesFixture,
  packageTerms,
  grantPackages,
  type PackageFixture,
} from './package-types.fixture.ts';

const ids = systemUuidV7();
let f: PackageFixture;
beforeAll(async () => {
  f = await packageTypesFixture();
  await grantPackages(f);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const request = (
  method: 'GET' | 'POST' | 'PATCH',
  suffix = '',
  body?: object,
  business = f.business,
) =>
  f.h.app.inject({
    method,
    url: `/v1/businesses/${business}/package-types${suffix}`,
    headers: { cookie: f.cookie, 'x-company-id': f.company },
    ...(body ? { payload: body } : {}),
  });

it('PT-09 foreign tenant and business package ids have the same 404 as unknown ids', async () => {
  const missing = ids.newId();
  const read = (await request('GET', `/${missing}`)).json();
  const write = (
    await request('PATCH', `/${missing}`, { ...packageTerms(f), expected_revision: 1 })
  ).json();
  for (const [companyId, businessId] of [
    [f.company, f.secondBusiness],
    [f.otherCompany, f.foreignBusiness],
  ]) {
    const service = await f.create.execute({
      companyId: companyId ?? '',
      businessId: businessId ?? '',
      userId: f.userId,
      input: { name_en: 'Service', price: '0.000', commission_rule: { kind: 'ZERO' } },
    });
    const foreign = await f.createPackage.execute({
      companyId: companyId ?? '',
      businessId: businessId ?? '',
      userId: f.userId,
      input: { ...packageTerms(f), components: [{ service_id: service.id, sessions: 1 }] },
    });
    const get = await request('GET', `/${foreign.id}`);
    const patch = await request('PATCH', `/${foreign.id}`, {
      ...packageTerms(f),
      expected_revision: 1,
    });
    expect(get.statusCode).toBe(404);
    expect(get.json()).toEqual(read);
    expect(patch.statusCode).toBe(404);
    expect(patch.json()).toEqual(write);
  }
});
it('PT-10 the same name can exist in a second business', async () => {
  const created = await request('POST', '', packageTerms(f));
  expect(created.statusCode).toBe(201);
});
it('PT-08 a business outside the grant has one uniform refusal', async () => {
  for (const business of [f.secondBusiness, f.foreignBusiness, ids.newId()]) {
    expect((await request('POST', '', packageTerms(f), business)).statusCode).toBe(403);
    expect((await request('GET', '', undefined, business)).statusCode).toBe(403);
  }
});
it('PT-08 feature disabled and Device close every route including historical personal ALLOWs', async () => {
  const made = packageTypeDetail.parse(
    (await request('POST', '', packageTerms(f, 'Access'))).json(),
  );
  const all = () =>
    Promise.all([
      request('GET'),
      request('GET', '/service-options'),
      request('GET', `/${made.id}`),
      request('POST', '', packageTerms(f)),
      request('PATCH', `/${made.id}`, { ...packageTerms(f), expected_revision: 1 }),
    ]);
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${f.company},'catalog',false,'Synthetic disabled',${f.userId})`;
  try {
    for (const r of await all()) expect(r.json()).toMatchObject({ code: 'FEATURE_DISABLED' });
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='catalog'`;
  }
  const [previous] = await f.h
    .owner`SELECT role_id,role_owner_key FROM memberships WHERE company_id=${f.company} AND id=${f.memberId}`;
  await f.h
    .owner`UPDATE memberships SET role_id='01920000-0000-7000-8000-00000000010e',role_owner_key='global'
    WHERE company_id=${f.company} AND id=${f.memberId}`;
  try {
    for (const r of await all()) expect(r.statusCode).toBe(403);
  } finally {
    await f.h
      .owner`UPDATE memberships SET role_id=${previous?.['role_id'] as string},role_owner_key=${previous?.['role_owner_key'] as string}
    WHERE company_id=${f.company} AND id=${f.memberId}`;
  }
});
