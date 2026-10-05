import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  detailFor,
  employeesFixture,
  grantEmployeeCreation,
  termsFor,
  type EmployeeFixture,
} from './employees.fixture.ts';

const ids = systemUuidV7();
let f: EmployeeFixture, employeeId: string, siblingId: string;
beforeAll(async () => {
  f = await employeesFixture();
  await grantEmployeeCreation(f);
  employeeId = (await create(f.branch)).id;
  const branch = ids.newId();
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES (${f.company},${branch},${f.business},'Synthetic sibling branch')`;
  siblingId = (await create(branch)).id;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const create = (branchId: string) =>
  f.useCase.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    input: { ...termsFor(f), primary_branch_id: branchId },
  });
const get = (record = employeeId, company = f.company, business = f.business) =>
  f.h.send('GET', `/v1/businesses/${business}/employees/${record}`, { cookie: f.cookie, company });

async function grants(rows: readonly ['ALLOW' | 'DENY', 'BUSINESS' | 'BRANCH', string][]) {
  await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company}
    AND membership_id=${f.memberId} AND permission_code='manage:employees:business'`;
  for (const [effect, scope, scopeId] of rows) {
    await f.h
      .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES (${f.company},${ids.newId()},${f.memberId},'manage:employees:business',${effect},${scope},${scopeId},'Synthetic scope decision',${f.userId})`;
  }
}
it('business ALLOW plus primary-branch DENY hides the detail exactly like a missing employee', async () => {
  await grants([
    ['ALLOW', 'BUSINESS', f.business],
    ['DENY', 'BRANCH', f.branch],
  ]);
  const refused = await get();
  const missing = await get(ids.newId());
  expect(refused.status).toBe(404);
  expect(missing.status).toBe(404);
  expect(refused.body).toEqual(missing.body);
  expect(refused.body['code']).toBe('NOT_FOUND');
  expect((await get(siblingId)).status).toBe(200);
  expect(await detailFor(f, f.company, f.business, employeeId)).toBeNull();
});
it('branch-only ALLOW returns that branch employee, without exposing another branch', async () => {
  await grants([['ALLOW', 'BRANCH', f.branch]]);
  expect(await get()).toMatchObject({
    status: 200,
    body: { id: employeeId, primary_branch_id: f.branch },
  });
  expect((await get(siblingId)).status).toBe(404);
  expect((await get(employeeId.toUpperCase(), f.company, f.business.toUpperCase())).status).toBe(
    200,
  );
});
it('no grant makes existing and missing employee refusals indistinguishable', async () => {
  await grants([]);
  const refused = await get();
  const missing = await get(ids.newId());
  expect(refused.status).toBe(404);
  expect(missing.status).toBe(404);
  expect(refused.body).toEqual(missing.body);
});
it('another tenant or business returns the same not-found envelope', async () => {
  await grants([['ALLOW', 'BUSINESS', f.business]]);
  const missing = await get(ids.newId());
  for (const response of [
    await get(employeeId, f.otherCompany),
    await get(employeeId, f.company, f.secondBusiness),
  ]) {
    expect(response.status).toBe(404);
    expect(response.body).toEqual(missing.body);
  }
});
it('the guarded read preserves staff feature enforcement and hides it from callers without access', async () => {
  await grants([['ALLOW', 'BRANCH', f.branch]]);
  await f.h
    .owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES (${f.company},'staff',false,'Synthetic feature denial',${f.userId})`;
  try {
    expect(await get()).toMatchObject({ status: 403, body: { code: 'FEATURE_DISABLED' } });
    expect((await get(ids.newId())).status).toBe(404);
    await grants([]);
    expect(await get()).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } });
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  }
});
it('requires a verified session before reading employee scope', async () => {
  const response = await f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${f.business}/employees/${employeeId}`,
  });
  expect(response.statusCode).toBe(401);
});
