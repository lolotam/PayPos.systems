import {
  attendanceProviders,
  cardProviders,
  enrolProviders,
} from './staff-attendance.providers.ts';
import { scheduleProviders } from './staff-schedule.providers.ts';
import { defaultShiftsProviders } from './staff-default-shifts.providers.ts';
import { documentProviders, employeeIbanProviders, salaryProviders } from './staff-records.providers.ts';
import { EmployeeDefaultShiftsController } from './http/employee-default-shifts.controller.ts';
import { EmployeeIbanController } from './http/employee-iban.controller.ts';
import { MyScheduleController } from './http/my-schedule.controller.ts';
import {
  PasskeysController,
  PASSKEY_OPTIONS,
  type RegistrationOptionsPort,
} from './http/passkeys.controller.ts';
import type { PasskeyRegistration } from './ports/passkeys.port.ts';
import { ClockAttendanceController } from './http/clock-attendance.controller.ts';
import type { AttendancePasskeys } from './ports/clock-attendance.port.ts';
import { EmployeePasskeysController } from './http/employee-passkeys.controller.ts';
import { EmployeePasskeyUnbindGuard } from './http/employee-passkey-unbind.guard.ts';
import { MANAGER_PASSKEY_ACCESS } from './queries/passkey-access.ts';
import { createManagerPasskeyAccess } from './persistence/manager-passkey-access.adapter.ts';
import { createUnbindPasskeyTransactions } from './persistence/unbind-passkey-transactions.ts';
import { UnbindPasskeyUseCase } from './use-cases/unbind-passkey/unbind-passkey.usecase.ts';
import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import type { Logger } from '@pospay/observability';
import { EmployeeLeaveController } from './http/employee-leave.controller.ts';
import { OwnLeaveController } from './http/own-leave.controller.ts';
import { LeaveInboxController } from './http/leave-inbox.controller.ts';
import { LeaveDecisionsController } from './http/leave-decisions.controller.ts';
import { AttendanceExceptionsController } from './http/attendance-exceptions.controller.ts';
import { AttendanceCorrectionsController } from './http/attendance-corrections.controller.ts';
import { ResolveAttendanceExceptionUseCase } from './use-cases/resolve-attendance-exception/resolve-attendance-exception.usecase.ts';
import { ReopenAttendanceExceptionUseCase } from './use-cases/reopen-attendance-exception/reopen-attendance-exception.usecase.ts';
import { createAttendanceExceptionTransactions } from './persistence/drizzle-attendance-exception-transactions.ts';
import { createAttendanceCorrectionTransactions } from './persistence/drizzle-attendance-correction-transactions.ts';
import { CorrectAttendanceUseCase } from './use-cases/correct-attendance/correct-attendance.usecase.ts';
import { DecideLeaveUseCase } from './use-cases/decide-leave/decide-leave.usecase.ts';
import { RevokeLeaveUseCase } from './use-cases/revoke-leave/revoke-leave.usecase.ts';
import { createLeaveTransactions } from './persistence/drizzle-leave-transactions.ts';
import { createLeaveReadAccess } from './persistence/leave-read-access.adapter.ts';
import { LEAVE_READ_ACCESS } from './queries/leave-requests.query.ts';
import { RequestLeaveUseCase } from './use-cases/request-leave/request-leave.usecase.ts';
import { CancelLeaveUseCase } from './use-cases/cancel-leave/cancel-leave.usecase.ts';
import { StaffLeaveGuard } from './http/staff-leave.guard.ts';
import { ScheduleSettingsController } from './http/schedule-settings.controller.ts';
import { BranchScheduleSettingsController } from './http/branch-schedule-settings.controller.ts';
import { SchedulesController } from './http/schedules.controller.ts';
import { ShiftTemplatesController } from './http/shift-templates.controller.ts';
import { EmployeeSalariesController } from './http/employee-salaries.controller.ts';
import { systemUuidV7 } from '@pospay/ids';
import { DocumentTypesController } from './http/document-types.controller.ts';
import { EmployeeDocumentsController } from './http/employee-documents.controller.ts';
import type { Redis } from 'ioredis';

import { systemClock } from '../../shared/adapters/system-clock.ts';
import { AttendanceQrController } from './http/attendance-qr.controller.ts';
import { EmployeesController } from './http/employees.controller.ts';
import { EmployeeImportController } from './http/employee-import.controller.ts';
import { EmployeeDetailGuard } from './http/employee-detail.guard.ts';
import { createEmployeeDetailAccess } from './persistence/employee-detail-access.adapter.ts';
import { EMPLOYEE_DETAIL_ACCESS } from './queries/employee-detail.query.ts';
import { createEmployeeTransactions } from './persistence/drizzle-employee-transactions.ts';
import { CreateEmployeeUseCase } from './use-cases/create-employee/create-employee.usecase.ts';
import { UpdateEmployeeUseCase } from './use-cases/update-employee/update-employee.usecase.ts';
import { createEmployeeUpdateTransactions } from './persistence/drizzle-employee-update.ts';
import { createEmployeeImportTransactions } from './persistence/drizzle-employee-import.ts';
import {
  createImportSheetReader,
  createImportTemplateBuilder,
  createObjectBytesReader,
} from './persistence/import-adapters.ts';
import { PreviewEmployeeImportUseCase } from './use-cases/preview-employee-import/preview-employee-import.usecase.ts';
import { CommitEmployeeImportUseCase } from './use-cases/commit-employee-import/commit-employee-import.usecase.ts';
import { GetEmployeeImportTemplateUseCase } from './use-cases/get-employee-import-template/get-employee-import-template.usecase.ts';
import { ClockByCardController } from './http/clock-by-card.controller.ts';
import { EmployeeCardsController } from './http/employee-cards.controller.ts';
import { AttendanceChangeRequestsController } from './http/attendance-change-requests.controller.ts';
import { attendanceChangeProviders } from './attendance-change.providers.ts';

export const staffControllers = [
  AttendanceChangeRequestsController,
  EmployeeDefaultShiftsController,
  EmployeeIbanController,
  ClockAttendanceController,
  ClockByCardController,
  EmployeeCardsController,
  EmployeePasskeysController,
  EmployeeLeaveController,
  OwnLeaveController,
  LeaveInboxController,
  LeaveDecisionsController,
  AttendanceExceptionsController,
  AttendanceCorrectionsController,
  AttendanceQrController,
  PasskeysController,
  MyScheduleController,
  EmployeesController,
  SchedulesController,
  ScheduleSettingsController,
  BranchScheduleSettingsController,
  ShiftTemplatesController,
  EmployeeSalariesController,
  DocumentTypesController,
  EmployeeDocumentsController,
  EmployeeImportController,
];

function attendanceCorrectionProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
): Provider[] {
  const tx = database === undefined ? null : createAttendanceCorrectionTransactions(database, ids);
  return [
    {
      provide: CorrectAttendanceUseCase,
      useValue: tx === null ? null : new CorrectAttendanceUseCase(tx, systemClock),
    },
  ];
}
function attendanceExceptionProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
): Provider[] {
  const tx = database === undefined ? null : createAttendanceExceptionTransactions(database, ids);
  return [
    {
      provide: ResolveAttendanceExceptionUseCase,
      useValue: tx === null ? null : new ResolveAttendanceExceptionUseCase(tx, systemClock),
    },
    {
      provide: ReopenAttendanceExceptionUseCase,
      useValue: tx === null ? null : new ReopenAttendanceExceptionUseCase(tx, systemClock),
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
          : new UnbindPasskeyUseCase(createUnbindPasskeyTransactions(database, ids, systemClock)),
    },
  ];
}

export function staffProviders(
  database?: TenantWrappers,
  redis?: Redis,
  passkeys: (PasskeyRegistration & RegistrationOptionsPort & AttendancePasskeys) | null = null,
  importStorage: { read(key: string, maxBytes: number): Promise<Uint8Array> } | null = null,
  employeeCardKey: Buffer | null = null,
  logger?: Logger,
): Provider[] {
  const ids = systemUuidV7();
  return [
    ...attendanceProviders(database, redis, passkeys, ids, logger),
    ...cardProviders(database, ids, employeeCardKey, redis, logger),
    { provide: PASSKEY_OPTIONS, useValue: passkeys },
    ...unbindProviders(database, ids),
    ...enrolProviders(database, ids, passkeys, logger),
    ...scheduleProviders(database, ids),
    ...defaultShiftsProviders(database, ids),
    ...leaveProviders(database, ids),
    ...attendanceExceptionProviders(database, ids),
    ...attendanceCorrectionProviders(database, ids),
    ...attendanceChangeProviders(database, ids),
    ...salaryProviders(database, ids),
    ...employeeIbanProviders(database, ids),
    ...documentProviders(database, ids),
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
    ...employeeImportProviders(database, ids, importStorage),
  ];
}

function employeeImportProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  importStorage: { read(key: string, maxBytes: number): Promise<Uint8Array> } | null,
): Provider[] {
  const transactions =
    database === undefined ? null : createEmployeeImportTransactions(database, ids);
  return [
    {
      provide: GetEmployeeImportTemplateUseCase,
      useValue:
        transactions === null
          ? null
          : new GetEmployeeImportTemplateUseCase(transactions, createImportTemplateBuilder()),
    },
    {
      provide: PreviewEmployeeImportUseCase,
      useValue:
        transactions === null || importStorage === null
          ? null
          : new PreviewEmployeeImportUseCase(
              transactions,
              createObjectBytesReader(importStorage),
              createImportSheetReader(),
              ids,
              systemClock,
            ),
    },
    {
      provide: CommitEmployeeImportUseCase,
      useValue:
        transactions === null
          ? null
          : new CommitEmployeeImportUseCase(transactions, ids, systemClock),
    },
  ];
}
