import { employeeAppLink } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  employeesFixture,
  grantEmployeeCreation,
  type EmployeeFixture,
} from './employees.fixture.ts';

const ids = systemUuidV7();
const unknownBusiness = ids.newId();
let f: EmployeeFixture;
let firstRefusal: unknown;

beforeAll(async () => {
  f = await employeesFixture();
  await grantEmployeeCreation(f);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

function send(businessId: string) {
  return f.h.send('GET', `/v1/businesses/${businessId}/staff/employee-app-link`, {
    cookie: f.cookie,
    company: f.company,
  });
}

it('EL-I07 returns the business names and ids to an employee manager', async () => {
  const result = await send(f.business);
  expect(result.status).toBe(200);
  const body = employeeAppLink.parse(result.body);
  expect(body).toEqual({
    company_id: f.company,
    business_id: f.business,
    business_name_en: 'Synthetic business',
    business_name_ar: null,
  });
});

it.each([
  { name: 'no grant on the business', business: (f: EmployeeFixture) => f.secondBusiness, deny: false },
  { name: 'a business DENY wins', business: (f: EmployeeFixture) => f.business, deny: true },
  { name: 'another company business', business: (f: EmployeeFixture) => f.foreignBusiness, deny: false },
  { name: 'unknown business', business: () => unknownBusiness, deny: false },
])('EL-I08 $name has the same 403 answer', async ({ business, deny }) => {
  const override = ids.newId();
  if (deny) {
    await f.h
      .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES(${f.company},${override},${f.memberId},'manage:employees:business','DENY','BUSINESS',${f.business},'synthetic',${f.userId})`;
  }
  try {
    const result = await send(business(f));
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('FORBIDDEN');
    if (firstRefusal === undefined) firstRefusal = result.body;
    else expect(result.body).toEqual(firstRefusal);
  } finally {
    if (deny) {
      await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${override}`;
    }
  }
});

it('requires a session', async () => {
  const response = await f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${f.business}/staff/employee-app-link`,
    headers: { 'x-company-id': f.company },
  });
  expect(response.statusCode).toBe(401);
});
