import { systemUuidV7 } from '@pospay/ids';

import {
  employeesFixture,
  grantEmployeeCreation,
  detailFor,
  termsFor,
  employeeUserMembership,
  type EmployeeFixture,
} from './employees.fixture.ts';

const ids = systemUuidV7();
export { grantEmployeeCreation, detailFor, termsFor, employeeUserMembership, type EmployeeFixture };
export const employeeNumberIds = ids;

export function assignFixture() {
  return employeesFixture();
}

export async function provisionEmployer(f: EmployeeFixture, label: string) {
  const companyId = await f.h.onboard(f.cookie, label);
  const businessId = ids.newId();
  const branchId = ids.newId();
  await f.h
    .owner`INSERT INTO businesses (company_id,id,name_en,vertical_type) VALUES (${companyId},${businessId},${label},'salon')`;
  await f.h
    .owner`INSERT INTO branches (company_id,id,business_id,name_en) VALUES (${companyId},${branchId},${businessId},${label})`;
  return { companyId, businessId, branchId };
}

export async function readCounter(f: EmployeeFixture, companyId = f.company) {
  const [row] = await f.h
    .owner`SELECT next_number FROM employee_number_sequences WHERE company_id=${companyId}`;
  return row === undefined ? null : Number(row['next_number']);
}

export async function setCounter(f: EmployeeFixture, next: number, companyId = f.company) {
  await f.h.owner`INSERT INTO employee_number_sequences (company_id, next_number)
    VALUES (${companyId}, ${next})
    ON CONFLICT (company_id) DO UPDATE SET next_number = ${next}, updated_at = now()`;
}

export async function insertHeldNumbers(
  f: EmployeeFixture,
  start: number,
  count: number,
  options: {
    companyId?: string;
    businessId?: string;
    branchId?: string;
    deleted?: boolean;
  } = {},
) {
  const companyId = options.companyId ?? f.company;
  const businessId = options.businessId ?? f.business;
  const branchId = options.branchId ?? f.branch;
  await f.h.owner`INSERT INTO employees (
      company_id, id, business_id, primary_branch_id, name_en, name_en_key, role_code, hire_date,
      employee_number, deleted_at)
    SELECT ${companyId}, gen_random_uuid(), ${businessId}, ${branchId},
      'Held ' || g::text, 'held-' || g::text, 'staff', '2020-01-01', ${start} + g - 1,
      CASE WHEN ${options.deleted === true} THEN now() ELSE NULL END
    FROM generate_series(1, ${count}) AS g`;
}

export function executeCreate(
  f: EmployeeFixture,
  name: string,
  extra: {
    companyId?: string;
    businessId?: string;
    branchId?: string;
    primary_branch_id?: string;
    user_id?: string;
  } = {},
) {
  return f.useCase.execute({
    companyId: extra.companyId ?? f.company,
    userId: f.userId,
    businessId: extra.businessId ?? f.business,
    input: {
      primary_branch_id: extra.primary_branch_id ?? extra.branchId ?? f.branch,
      name_en: name,
      role_code: 'staff',
      hire_date: '2026-01-01',
      ...(extra.user_id === undefined ? {} : { user_id: extra.user_id }),
    },
  });
}

export function sendCreate(
  f: EmployeeFixture,
  body: object,
  business = f.business,
  company = f.company,
) {
  return f.h.send('POST', `/v1/businesses/${business}/employees`, {
    cookie: f.cookie,
    company,
    body,
  });
}

export async function createdCounts(f: EmployeeFixture, companyId = f.company) {
  const [employees] = await f.h
    .owner`SELECT count(*) AS n FROM employees WHERE company_id=${companyId}`;
  const [attachments] = await f.h
    .owner`SELECT count(*) AS n FROM employee_branches WHERE company_id=${companyId}`;
  const [audits] = await f.h
    .owner`SELECT count(*) AS n FROM audit_log WHERE company_id=${companyId} AND entity='employee' AND action='created'`;
  return { employees, attachments, audits };
}
