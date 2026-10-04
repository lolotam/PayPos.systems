import { SYSTEM_ROLES } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { employeesFixture, grantEmployeeCreation, termsFor } from './employees.fixture.ts';
import { createLeaveTransactions } from '../persistence/drizzle-leave-transactions.ts';
import { createLeaveReadAccess } from '../persistence/leave-read-access.adapter.ts';
import { RequestLeaveUseCase } from '../use-cases/request-leave/request-leave.usecase.ts';
import { CancelLeaveUseCase } from '../use-cases/cancel-leave/cancel-leave.usecase.ts';
export const leaveIds = systemUuidV7();
export async function leaveFixture() {
  const f = await employeesFixture({ staffOrigin: 'http://pos.synthetic.invalid' });
  await grantEmployeeCreation(f);
  const employee = await f.useCase.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    input: termsFor(f),
  });
  await f.h
    .owner`UPDATE employees SET user_id=${f.userId} WHERE company_id=${f.company} AND id=${employee.id}`;
  const role = SYSTEM_ROLES.find((r) => r.code === 'business_manager');
  await f.h
    .owner`UPDATE memberships SET role_id=${role?.id as string},role_owner_key='global',scope_type='BUSINESS',scope_id=${f.business} WHERE company_id=${f.company} AND id=${f.memberId}`;
  const secondBranch = leaveIds.newId();
  await f.h
    .owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.company},${secondBranch},${f.business},'Synthetic leave branch')`;
  await f.h
    .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from") VALUES(${f.company},${leaveIds.newId()},${f.business},${employee.id},${secondBranch},'2026-01-01')`;
  const clock = { now: () => new Date('2026-10-04T10:00:00Z') };
  const tx = createLeaveTransactions(f.db, leaveIds);
  return {
    ...f,
    employee,
    secondBranch,
    clock,
    access: createLeaveReadAccess(),
    request: new RequestLeaveUseCase(tx, leaveIds, clock),
    cancel: new CancelLeaveUseCase(tx, clock),
  };
}
export type LeaveFixture = Awaited<ReturnType<typeof leaveFixture>>;
export const leaveActor = (f: LeaveFixture, key = leaveIds.newId()) => ({
  companyId: f.company,
  userId: f.userId,
  businessId: f.business,
  branchId: f.branch,
  employeeId: f.employee.id,
  own: false,
  key,
  fingerprint: key,
});
export const leaveTerms = (from = '2027-01-01', to = from) => ({
  kind: 'FULL_DAY' as const,
  from,
  to,
  type: 'ANNUAL' as const,
});
export const leaveContext = (f: LeaveFixture) => ({
  companyId: f.company,
  userId: f.userId,
  businessId: f.business,
  employeeId: f.employee.id,
  own: false,
});
