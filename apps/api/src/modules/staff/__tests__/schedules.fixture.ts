import { SYSTEM_ROLES } from '@pospay/db';
import type { SetScheduleInput } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { createApp } from '../../../app.ts';
import { createPersonalEligibility } from '../persistence/personal-employee.ts';
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
export const testPattern: [SetScheduleInput['shifts'][number], SetScheduleInput['shifts'][number]] =
  [
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
  shifts: SetScheduleInput['shifts'] = testPattern,
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

export const breakPattern: [SetScheduleInput['shifts'][number]] = [
  { day: 0, start: '09:00', end: '17:00', break_start: '13:00', break_end: '14:00' },
];
export const nullBreak = {
  break_start: null,
  break_end: null,
  break_starts_at: null,
  break_ends_at: null,
};
export const weekUrl = (f: SchedulesFixture) =>
  `/v1/businesses/${f.business}/branches/${f.branch}/schedules`;
export function putWeek(f: SchedulesFixture, input: SetScheduleInput) {
  return f.h.app.inject({
    method: 'PUT',
    url: `${weekUrl(f)}/${f.employee.id}`,
    headers: { cookie: f.cookie, 'x-company-id': f.company },
    payload: input,
  });
}

export async function readPersonalWeek(f: SchedulesFixture, week: string) {
  await f.h
    .owner`UPDATE employees SET user_id=${f.userId} WHERE company_id=${f.company} AND id=${f.employee.id}`;
  await f.h
    .owner`UPDATE "user" SET phone_number='+15555550199' WHERE id=${f.userId}`;
  await f.h.owner`UPDATE "user" SET phone_binding_approved_at='2026-01-01' WHERE id=${f.userId}`;
  const eligibility = createPersonalEligibility(f.db);
  const context = {
    purpose: 'STAFF_PERSONAL' as const,
    companyId: f.company,
    businessId: f.business,
  };
  const issued = await f.h.auth.personal.issue(f.userId, context, () =>
    eligibility.eligible(f.userId, context),
  );
  const app = await createApp({
    readiness: [],
    database: f.db,
    personal: {
      origin: 'http://localhost:5173',
      sessions: f.h.auth.personal,
      eligibility,
      otp: null,
    },
  });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/staff/my-schedule?week_start=${week}&branch_id=${f.branch}`,
      headers: { cookie: issued.cookie.split(';')[0] ?? '', origin: 'http://localhost:5173' },
    });
    return { status: response.statusCode, body: response.json() };
  } finally {
    await app.close();
  }
}
