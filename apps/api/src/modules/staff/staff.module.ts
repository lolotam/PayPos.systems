import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { SchedulesController } from './http/schedules.controller.ts';
import { ShiftTemplatesController } from './http/shift-templates.controller.ts';
import { createScheduleTransactions } from './persistence/drizzle-schedules.ts';
import { createScheduleReadAccess } from './persistence/schedule-read-access.adapter.ts';
import { SCHEDULE_READ_ACCESS } from './queries/schedule-week.query.ts';
import { SetScheduleUseCase } from './use-cases/set-schedule/set-schedule.usecase.ts';
import { CreateShiftTemplateUseCase } from './use-cases/create-shift-template/create-shift-template.usecase.ts';
import { UpdateShiftTemplateUseCase } from './use-cases/update-shift-template/update-shift-template.usecase.ts';
import { ArchiveShiftTemplateUseCase } from './use-cases/archive-shift-template/archive-shift-template.usecase.ts';
import { ApplyShiftTemplateUseCase } from './use-cases/apply-shift-template/apply-shift-template.usecase.ts';
import { systemUuidV7 } from '@pospay/ids';
import type { Redis } from 'ioredis';

import { systemClock } from '../../shared/adapters/system-clock.ts';
import { AttendanceQrController } from './http/attendance-qr.controller.ts';
import { EmployeesController } from './http/employees.controller.ts';
import { EmployeeDetailGuard } from './http/employee-detail.guard.ts';
import { createEmployeeDetailAccess } from './persistence/employee-detail-access.adapter.ts';
import { EMPLOYEE_DETAIL_ACCESS } from './queries/employee-detail.query.ts';
import { createEmployeeTransactions } from './persistence/drizzle-employee-transactions.ts';
import { CreateEmployeeUseCase } from './use-cases/create-employee/create-employee.usecase.ts';
import { UpdateEmployeeUseCase } from './use-cases/update-employee/update-employee.usecase.ts';
import { createEmployeeUpdateTransactions } from './persistence/drizzle-employee-update.ts';
import { hmacAttendanceQr } from './persistence/hmac-attendance-qr.ts';
import { createRedisAttendanceQrSecrets } from './persistence/redis-attendance-qr-secrets.ts';
import { createAttendanceBranchReader } from './persistence/tenancy-attendance-branch.adapter.ts';
import { IssueAttendanceQr } from './use-cases/issue-attendance-qr/issue-attendance-qr.ts';
import { VerifyAttendanceQr } from './use-cases/verify-attendance-qr/verify-attendance-qr.ts';

export const staffControllers = [
  AttendanceQrController,
  EmployeesController,
  SchedulesController,
  ShiftTemplatesController,
];

function scheduleProviders(database: TenantWrappers | undefined, ids: IdGenerator): Provider[] {
  const transactions = database === undefined ? null : createScheduleTransactions(database, ids);
  return [
    { provide: SCHEDULE_READ_ACCESS, useValue: createScheduleReadAccess() },
    {
      provide: SetScheduleUseCase,
      useValue:
        transactions === null ? null : new SetScheduleUseCase(transactions, ids, systemClock),
    },
    {
      provide: CreateShiftTemplateUseCase,
      useValue: transactions === null ? null : new CreateShiftTemplateUseCase(transactions, ids),
    },
    {
      provide: UpdateShiftTemplateUseCase,
      useValue: transactions === null ? null : new UpdateShiftTemplateUseCase(transactions),
    },
    {
      provide: ArchiveShiftTemplateUseCase,
      useValue:
        transactions === null ? null : new ArchiveShiftTemplateUseCase(transactions, systemClock),
    },
    {
      provide: ApplyShiftTemplateUseCase,
      useValue:
        transactions === null
          ? null
          : new ApplyShiftTemplateUseCase(transactions, ids, systemClock),
    },
  ];
}

export function staffProviders(database?: TenantWrappers, redis?: Redis): Provider[] {
  const ids = systemUuidV7();
  const secrets = redis === undefined ? null : createRedisAttendanceQrSecrets(redis);
  const branches = database === undefined ? null : createAttendanceBranchReader(database);
  return [
    ...scheduleProviders(database, ids),
    {
      provide: UpdateEmployeeUseCase,
      useValue:
        database === undefined
          ? null
          : new UpdateEmployeeUseCase(createEmployeeUpdateTransactions(database, ids), ids),
    },
    EmployeeDetailGuard,
    {
      provide: EMPLOYEE_DETAIL_ACCESS,
      useValue: database === undefined ? null : createEmployeeDetailAccess(),
    },
    {
      provide: CreateEmployeeUseCase,
      useValue:
        database === undefined
          ? null
          : new CreateEmployeeUseCase(createEmployeeTransactions(database, ids), ids, systemClock),
    },
    {
      provide: IssueAttendanceQr,
      useValue:
        branches === null || secrets === null
          ? null
          : new IssueAttendanceQr(branches, secrets, hmacAttendanceQr, systemClock),
    },
    {
      provide: VerifyAttendanceQr,
      useValue:
        branches === null || secrets === null
          ? null
          : new VerifyAttendanceQr(branches, secrets, hmacAttendanceQr, systemClock),
    },
  ];
}
