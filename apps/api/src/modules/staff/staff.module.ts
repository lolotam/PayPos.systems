import { MyScheduleController } from './http/my-schedule.controller.ts';
import {
  PasskeysController,
  PASSKEY_OPTIONS,
  type RegistrationOptionsPort,
} from './http/passkeys.controller.ts';
import type { PasskeyRegistration } from './ports/passkeys.port.ts';
import { ClockAttendanceController } from './http/clock-attendance.controller.ts';
import { createAttendanceTransactions } from './persistence/attendance-transactions.ts';
import { createLockedAttendanceQrVerifier } from './persistence/locked-attendance-qr.ts';
import { ClockAttendance } from './use-cases/clock-attendance/clock-attendance.ts';
import { RequestClockChallenge } from './use-cases/request-clock-challenge/request-clock-challenge.ts';
import type { AttendancePasskeys } from './ports/clock-attendance.port.ts';
import { EmployeePasskeysController } from './http/employee-passkeys.controller.ts';
import { EmployeePasskeyUnbindGuard } from './http/employee-passkey-unbind.guard.ts';
import { MANAGER_PASSKEY_ACCESS } from './queries/passkey-access.ts';
import { createManagerPasskeyAccess } from './persistence/manager-passkey-access.adapter.ts';
import { createUnbindPasskeyTransactions } from './persistence/unbind-passkey-transactions.ts';
import { UnbindPasskeyUseCase } from './use-cases/unbind-passkey/unbind-passkey.usecase.ts';
import { EnrolPasskey } from './use-cases/enrol-passkey/enrol-passkey.ts';
import { createPasskeyTransactions } from './persistence/passkey-transactions.ts';
import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { EmployeeLeaveController } from './http/employee-leave.controller.ts';
import { OwnLeaveController } from './http/own-leave.controller.ts';
import { LeaveInboxController } from './http/leave-inbox.controller.ts';
import { LeaveDecisionsController } from './http/leave-decisions.controller.ts';
import { DecideLeaveUseCase } from './use-cases/decide-leave/decide-leave.usecase.ts';
import { RevokeLeaveUseCase } from './use-cases/revoke-leave/revoke-leave.usecase.ts';
import { createLeaveTransactions } from './persistence/drizzle-leave-transactions.ts';
import { createLeaveReadAccess } from './persistence/leave-read-access.adapter.ts';
import { LEAVE_READ_ACCESS } from './queries/leave-requests.query.ts';
import { RequestLeaveUseCase } from './use-cases/request-leave/request-leave.usecase.ts';
import { CancelLeaveUseCase } from './use-cases/cancel-leave/cancel-leave.usecase.ts';
import { StaffLeaveGuard } from './http/staff-leave.guard.ts';
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
import { EmployeeSalariesController } from './http/employee-salaries.controller.ts';
import { SetSalaryUseCase } from './use-cases/set-salary/set-salary.usecase.ts';
import { createSalaryTransactions } from './persistence/drizzle-salary-transactions.ts';
import { createSalaryAccess } from './persistence/employee-salary-access.adapter.ts';
import { SALARY_ACCESS } from './queries/salary-history.query.ts';
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
  ClockAttendanceController,
  EmployeePasskeysController,
  EmployeeLeaveController,
  OwnLeaveController,
  LeaveInboxController,
  LeaveDecisionsController,
  AttendanceQrController,
  PasskeysController,
  MyScheduleController,
  EmployeesController,
  SchedulesController,
  ShiftTemplatesController,
  EmployeeSalariesController,
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
function leaveProviders(database: TenantWrappers | undefined, ids: IdGenerator): Provider[] {
  const tx = database === undefined ? null : createLeaveTransactions(database, ids);
  return [
    {
      provide: DecideLeaveUseCase,
      useValue: tx === null ? null : new DecideLeaveUseCase(tx, systemClock),
    },
    {
      provide: RevokeLeaveUseCase,
      useValue: tx === null ? null : new RevokeLeaveUseCase(tx, systemClock),
    },
    StaffLeaveGuard,
    { provide: LEAVE_READ_ACCESS, useValue: createLeaveReadAccess(systemClock) },
    {
      provide: RequestLeaveUseCase,
      useValue: tx === null ? null : new RequestLeaveUseCase(tx, ids, systemClock),
    },
    {
      provide: CancelLeaveUseCase,
      useValue: tx === null ? null : new CancelLeaveUseCase(tx, systemClock),
    },
  ];
}

function salaryProviders(database: TenantWrappers | undefined, ids: IdGenerator): Provider[] {
  return [
    {
      provide: SetSalaryUseCase,
      useValue:
        database === undefined
          ? null
          : new SetSalaryUseCase(createSalaryTransactions(database, ids), ids),
    },
    { provide: SALARY_ACCESS, useValue: database === undefined ? null : createSalaryAccess() },
  ];
}

function unbindProviders(database: TenantWrappers | undefined, ids: IdGenerator): Provider[] {
  return [
    EmployeePasskeyUnbindGuard,
    {
      provide: MANAGER_PASSKEY_ACCESS,
      useValue: database === undefined ? null : createManagerPasskeyAccess(systemClock),
    },
    {
      provide: UnbindPasskeyUseCase,
      useValue:
        database === undefined
          ? null
          : new UnbindPasskeyUseCase(
              createUnbindPasskeyTransactions(database, ids, systemClock),
              systemClock,
            ),
    },
  ];
}

export function staffProviders(
  database?: TenantWrappers,
  redis?: Redis,
  passkeys: (PasskeyRegistration & RegistrationOptionsPort & AttendancePasskeys) | null = null,
): Provider[] {
  const ids = systemUuidV7();
  const secrets = redis === undefined ? null : createRedisAttendanceQrSecrets(redis);
  const branches = database === undefined ? null : createAttendanceBranchReader(database);
  return [
    ...attendanceProviders(database, secrets, passkeys, ids),
    { provide: PASSKEY_OPTIONS, useValue: passkeys },
    ...unbindProviders(database, ids),
    {
      provide: EnrolPasskey,
      useValue:
        database === undefined || passkeys === null
          ? null
          : new EnrolPasskey(passkeys, createPasskeyTransactions(database, ids), ids, systemClock),
    },
    ...scheduleProviders(database, ids),
    ...leaveProviders(database, ids),
    ...salaryProviders(database, ids),
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

function attendanceProviders(
  database: TenantWrappers | undefined,
  secrets: ReturnType<typeof createRedisAttendanceQrSecrets> | null,
  passkeys: AttendancePasskeys | null,
  ids: IdGenerator,
): Provider[] {
  if (database === undefined || secrets === null || passkeys === null)
    return [
      { provide: ClockAttendance, useValue: null },
      { provide: RequestClockChallenge, useValue: null },
    ];
  const qr = createLockedAttendanceQrVerifier(secrets, hmacAttendanceQr);
  const transactions = createAttendanceTransactions(database, ids);
  return [
    {
      provide: ClockAttendance,
      useValue: new ClockAttendance(transactions, passkeys, qr, systemClock, ids),
    },
    {
      provide: RequestClockChallenge,
      useValue: new RequestClockChallenge(transactions, passkeys, qr, systemClock),
    },
  ];
}
