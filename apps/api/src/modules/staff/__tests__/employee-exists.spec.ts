import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { employeeExistsInBusiness } from '../persistence/employee-exists.ts';
import {
  employeesFixture,
  grantEmployeeCreation,
  termsFor,
  type EmployeeFixture,
} from './employees.fixture.ts';

let f: EmployeeFixture;
beforeAll(async () => {
  f = await employeesFixture();
  await grantEmployeeCreation(f);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

async function createEmployee(name: string): Promise<string> {
  const created = await f.useCase.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    input: termsFor(f, name),
  });
  return created.id;
}

it('finds the employee in its own business only', async () => {
  const employeeId = await createEmployee('Exists employee');
  await f.db.withTenant(f.company, async (tx) => {
    expect(await employeeExistsInBusiness(tx, f.company, f.business, employeeId)).toBe(true);
    expect(await employeeExistsInBusiness(tx, f.company, f.secondBusiness, employeeId)).toBe(false);
    expect(await employeeExistsInBusiness(tx, f.company, f.business, systemUuidV7().newId())).toBe(
      false,
    );
  });
});

it('does not see an employee of another company', async () => {
  const employeeId = await createEmployee('Foreign employee');
  await f.db.withTenant(f.otherCompany, async (tx) => {
    expect(await employeeExistsInBusiness(tx, f.otherCompany, f.foreignBusiness, employeeId)).toBe(
      false,
    );
  });
});

it('a deleted employee does not exist any more', async () => {
  const employeeId = await createEmployee('Deleted employee');
  await f.h.owner`UPDATE employees SET deleted_at=now()
    WHERE company_id=${f.company} AND id=${employeeId}`;
  await f.db.withTenant(f.company, async (tx) => {
    expect(await employeeExistsInBusiness(tx, f.company, f.business, employeeId)).toBe(false);
  });
});
