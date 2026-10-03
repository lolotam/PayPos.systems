import { createDatabase, OWNER_ROLE_ID } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
const employeeIds = systemUuidV7();
import { startHarness } from '../../../../test/harness.ts';
import { createEmployeeTransactions } from '../persistence/drizzle-employee-transactions.ts';
import { CreateEmployeeUseCase } from '../use-cases/create-employee/create-employee.usecase.ts';
import { createEmployeeDetailAccess } from '../persistence/employee-detail-access.adapter.ts';
import { employeeDetail } from '../queries/employee-detail.query.ts';

export async function employeesFixture() {
  const h = await startHarness();
  const ownerCookie = await h.signedInOperator('employee-owner@example.test');
  const cookie = await h.signedInOperator('employee-manager@example.test');
  const company = await h.onboard(ownerCookie, 'Synthetic employer');
  const otherCompany = await h.onboard(cookie, 'Synthetic other employer');
  const [holder] = await h.owner`SELECT id FROM "user" WHERE email='employee-manager@example.test'`;
  const userId = holder?.['id'] as string;
  const memberId = employeeIds.newId();
  const viewer = employeeIds.newId();
  await h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${viewer},${company},'synthetic_employee_editor','Synthetic employee editor')`;
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${company},${memberId},${userId},${viewer},${company},'COMPANY',${company})`;
  const business = employeeIds.newId();
  const secondBusiness = employeeIds.newId();
  const foreignBusiness = employeeIds.newId();
  for (const [co, bu] of [
    [company, business],
    [company, secondBusiness],
    [otherCompany, foreignBusiness],
  ]) {
    await h.owner`INSERT INTO businesses (company_id,id,name_en,vertical_type) VALUES (${co as string},${bu as string},'Synthetic business','salon')`;
  }
  const branch = employeeIds.newId();
  const otherBranch = employeeIds.newId();
  const foreignBranch = employeeIds.newId();
  for (const [co, bu, br] of [
    [company, business, branch],
    [company, secondBusiness, otherBranch],
    [otherCompany, foreignBusiness, foreignBranch],
  ]) {
    await h.owner`INSERT INTO branches (company_id,id,business_id,name_en) VALUES (${co as string},${br as string},${bu as string},'Synthetic branch')`;
  }
  const db = createDatabase({ url: h.urls.app, ids: employeeIds });
  const transactions = createEmployeeTransactions(db, employeeIds);
  const useCase = new CreateEmployeeUseCase(transactions, employeeIds, {
    now: () => new Date('2026-10-03T10:00:00Z'),
  });
  return {
    h,
    cookie,
    company,
    otherCompany,
    userId,
    memberId,
    business,
    secondBusiness,
    branch,
    otherBranch,
    foreignBranch,
    db,
    transactions,
    useCase,
  };
}
export type EmployeeFixture = Awaited<ReturnType<typeof employeesFixture>>;
export const termsFor = (f: EmployeeFixture, name = 'Synthetic employee') => ({
  primary_branch_id: f.branch,
  name_en: name,
  role_code: 'staff' as const,
  hire_date: '2026-01-01',
});
export async function grantEmployeeCreation(f: EmployeeFixture, business = f.business) {
  await f.h
    .owner`INSERT INTO permission_overrides (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${f.company},${employeeIds.newId()},${f.memberId},'manage:employees:business','ALLOW','BUSINESS',${business},'Synthetic grant',${f.userId})`;
}

export function detailFor(
  f: EmployeeFixture,
  companyId: string,
  businessId: string,
  employeeId: string,
) {
  return f.db.withTenant(companyId, (tx) =>
    employeeDetail(tx, companyId, businessId, employeeId, f.userId, createEmployeeDetailAccess()),
  );
}

export async function employeeUserMembership(
  f: EmployeeFixture,
  userId: string,
  options: {
    companyId?: string;
    businessId?: string;
    startsAt?: string;
    endsAt?: string | null;
  } = {},
) {
  const membershipId = employeeIds.newId();
  const company = options.companyId ?? f.company;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at,ends_at)
    VALUES (${company},${membershipId},${userId},${OWNER_ROLE_ID},'global',${options.businessId === undefined ? 'COMPANY' : 'BUSINESS'},
    ${options.businessId ?? company},${options.startsAt ?? '2000-01-01T00:00:00Z'},${options.endsAt ?? null})`;
  return membershipId;
}
