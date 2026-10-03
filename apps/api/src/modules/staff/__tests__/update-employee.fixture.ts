import { systemUuidV7 } from '@pospay/ids';
import type { EmployeeDetail, UpdateEmployeeInput } from '@pospay/contracts';
import {
  employeesFixture,
  grantEmployeeCreation,
  termsFor,
  detailFor,
} from './employees.fixture.ts';
import { createEmployeeUpdateTransactions } from '../persistence/drizzle-employee-update.ts';
import { UpdateEmployeeUseCase } from '../use-cases/update-employee/update-employee.usecase.ts';

export const ids = systemUuidV7();
export async function updateEmployeeFixture() {
  const f = await employeesFixture();
  await grantEmployeeCreation(f);
  const sibling = ids.newId();
  await f.h
    .owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES (${f.company},${sibling},${f.business},'Synthetic sibling')`;
  const transactions = createEmployeeUpdateTransactions(f.db, ids);
  const update = new UpdateEmployeeUseCase(transactions, ids);
  return { ...f, sibling, updateTransactions: transactions, update };
}
export type UpdateFixture = Awaited<ReturnType<typeof updateEmployeeFixture>>;
export async function createForUpdate(f: UpdateFixture, change = {}) {
  const created = await f.useCase.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    input: { ...termsFor(f), ...change },
  });
  return (await detailFor(f, f.company, f.business, created.id)) as EmployeeDetail;
}
export function updateTerms(
  record: EmployeeDetail,
  change: Partial<UpdateEmployeeInput> = {},
): UpdateEmployeeInput {
  return {
    primary_branch_id: record.primary_branch_id,
    name_en: record.name_en,
    name_ar: record.name_ar,
    role_code: record.role_code,
    hire_date: record.hire_date,
    contract_end: record.contract_end,
    user_id: record.user_id,
    expected_revision: record.revision,
    branch_ids: record.branch_ids,
    branch_effective_date: '2026-10-03',
    ...change,
  };
}
export const executeUpdate = (
  f: UpdateFixture,
  record: EmployeeDetail,
  change: Partial<UpdateEmployeeInput> = {},
) =>
  f.update.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    employeeId: record.id,
    input: updateTerms(record, change),
  });
export async function patchEmployee(
  f: UpdateFixture,
  record: EmployeeDetail,
  change: object = {},
  businessId = f.business,
  company = f.company,
) {
  const response = await f.h.app.inject({
    method: 'PATCH',
    url: `/v1/businesses/${businessId}/employees/${record.id}`,
    headers: { cookie: f.cookie, 'x-company-id': company },
    payload: { ...updateTerms(record), ...change },
  });
  return { status: response.statusCode, body: response.json() as Record<string, unknown> };
}
export async function employeeGrants(
  f: UpdateFixture,
  rows: readonly ['ALLOW' | 'DENY', 'BUSINESS' | 'BRANCH', string][],
) {
  await f.h
    .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.memberId} AND permission_code='manage:employees:business'`;
  for (const [effect, scope, scopeId] of rows)
    await f.h
      .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by) VALUES (${f.company},${ids.newId()},${f.memberId},'manage:employees:business',${effect},${scope},${scopeId},'Synthetic decision',${f.userId})`;
}
