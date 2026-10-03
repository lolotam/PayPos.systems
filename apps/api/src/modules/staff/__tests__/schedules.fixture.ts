import { SYSTEM_ROLES } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { employeesFixture, grantEmployeeCreation, termsFor } from './employees.fixture.ts';
import { createScheduleTransactions } from '../persistence/drizzle-schedules.ts';
import { createScheduleReadAccess } from '../persistence/schedule-read-access.adapter.ts';
import { SetScheduleUseCase } from '../use-cases/set-schedule/set-schedule.usecase.ts';
import { CreateShiftTemplateUseCase } from '../use-cases/create-shift-template/create-shift-template.usecase.ts';
import { UpdateShiftTemplateUseCase } from '../use-cases/update-shift-template/update-shift-template.usecase.ts';
import { ArchiveShiftTemplateUseCase } from '../use-cases/archive-shift-template/archive-shift-template.usecase.ts';
import { ApplyShiftTemplateUseCase } from '../use-cases/apply-shift-template/apply-shift-template.usecase.ts';
export const scheduleIds = systemUuidV7();
export const testWeek = '2026-10-03';
export const testPattern = [
  { day: 0, start: '09:00', end: '13:00' },
  { day: 6, start: '22:00', end: '06:00' },
];
export async function schedulesFixture() {
  const f = await employeesFixture();
  await grantEmployeeCreation(f);
  const employee = await f.useCase.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    input: termsFor(f),
  });
  // مدير نشاط نظامي يختبر حزم PR 16؛ الدور المخصص في تجهيز الموظفين له سياسة مستقلة.
  const manager = SYSTEM_ROLES.find((role) => role.code === 'business_manager');
  await f.h
    .owner`UPDATE memberships SET role_id=${manager?.id as string},role_owner_key='global',scope_type='BUSINESS',scope_id=${f.business}
    WHERE company_id=${f.company} AND id=${f.memberId}`;
  const secondBranch = scheduleIds.newId();
  await f.h
    .owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.company},${secondBranch},${f.business},'Synthetic second branch')`;
  await f.h
    .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from") VALUES(${f.company},${scheduleIds.newId()},${f.business},${employee.id},${secondBranch},'2026-01-01')`;
  const transactions = createScheduleTransactions(f.db, scheduleIds);
  const clock = { now: () => new Date('2026-10-03T10:00:00Z') };
  return {
    ...f,
    employee,
    secondBranch,
    transactions,
    clock,
    access: createScheduleReadAccess(),
    set: new SetScheduleUseCase(transactions, scheduleIds, clock),
    createTemplate: new CreateShiftTemplateUseCase(transactions, scheduleIds),
    updateTemplate: new UpdateShiftTemplateUseCase(transactions),
    archiveTemplate: new ArchiveShiftTemplateUseCase(transactions, clock),
    applyTemplate: new ApplyShiftTemplateUseCase(transactions, scheduleIds, clock),
  };
}
export type SchedulesFixture = Awaited<ReturnType<typeof schedulesFixture>>;
export const scheduleActor = (f: SchedulesFixture) => ({
  companyId: f.company,
  userId: f.userId,
  businessId: f.business,
});
export function setWeek(
  f: SchedulesFixture,
  shifts = testPattern,
  options: {
    week?: string;
    branch?: string;
    employee?: string;
    revision?: number;
    reason?: string;
  } = {},
) {
  return f.set.execute({
    ...scheduleActor(f),
    branchId: options.branch ?? f.branch,
    employeeId: options.employee ?? f.employee.id,
    input: {
      week_start: options.week ?? testWeek,
      expected_revision: options.revision ?? 0,
      shifts,
      ...(options.reason ? { reason: options.reason } : {}),
    },
  });
}
