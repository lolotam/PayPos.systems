import { attendanceProviders, cardProviders } from './staff-attendance.providers.ts';
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
import { DocumentTypesController } from './http/document-types.controller.ts';
import { EmployeeDocumentsController } from './http/employee-documents.controller.ts';
import { createDocumentTypeTransactions } from './persistence/drizzle-document-types.ts';
import { createEmployeeDocumentTransactions } from './persistence/drizzle-employee-documents.ts';
import { createEmployeeDocumentReadAccess } from './persistence/document-access.adapter.ts';
import { EMPLOYEE_DOCUMENT_ACCESS } from './queries/employee-documents.query.ts';
import { CreateDocumentTypeUseCase } from './use-cases/create-document-type/create-document-type.usecase.ts';
import { UpdateDocumentTypeUseCase } from './use-cases/update-document-type/update-document-type.usecase.ts';
import { DeactivateDocumentTypeUseCase } from './use-cases/deactivate-document-type/deactivate-document-type.usecase.ts';
import { ReactivateDocumentTypeUseCase } from './use-cases/reactivate-document-type/reactivate-document-type.usecase.ts';
import { RecordEmployeeDocumentUseCase } from './use-cases/record-employee-document/record-employee-document.usecase.ts';
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

export const staffControllers = [
  ClockAttendanceController,
  ClockByCardController,
  EmployeeCardsController,
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
  DocumentTypesController,
  EmployeeDocumentsController,
  EmployeeImportController,
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

function documentProviders(database: TenantWrappers | undefined, ids: IdGenerator): Provider[] {
  const types = database === undefined ? null : createDocumentTypeTransactions(database, ids);
  const records = database === undefined ? null : createEmployeeDocumentTransactions(database, ids);
  return [
    {
      provide: EMPLOYEE_DOCUMENT_ACCESS,
      useValue: database === undefined ? null : createEmployeeDocumentReadAccess(systemClock),
    },
    {
      provide: CreateDocumentTypeUseCase,
      useValue: types === null ? null : new CreateDocumentTypeUseCase(types, ids),
    },
    {
      provide: UpdateDocumentTypeUseCase,
      useValue: types === null ? null : new UpdateDocumentTypeUseCase(types),
    },
    {
      provide: DeactivateDocumentTypeUseCase,
      useValue: types === null ? null : new DeactivateDocumentTypeUseCase(types),
    },
    {
      provide: ReactivateDocumentTypeUseCase,
      useValue: types === null ? null : new ReactivateDocumentTypeUseCase(types),
    },
    {
      provide: RecordEmployeeDocumentUseCase,
      useValue:
        records === null ? null : new RecordEmployeeDocumentUseCase(records, ids, systemClock),
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

function enrolProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  passkeys: (PasskeyRegistration & RegistrationOptionsPort & AttendancePasskeys) | null,
): Provider[] {
  return [
    {
      provide: EnrolPasskey,
      useValue:
        database === undefined || passkeys === null
          ? null
          : new EnrolPasskey(passkeys, createPasskeyTransactions(database, ids), ids, systemClock),
    },
  ];
}

export function staffProviders(
  database?: TenantWrappers,
  redis?: Redis,
  passkeys: (PasskeyRegistration & RegistrationOptionsPort & AttendancePasskeys) | null = null,
  importStorage: { read(key: string, maxBytes: number): Promise<Uint8Array> } | null = null,
  employeeCardKey: Buffer | null = null,
): Provider[] {
  const ids = systemUuidV7();
  return [
    ...attendanceProviders(database, redis, passkeys, ids),
    ...cardProviders(database, ids, employeeCardKey, redis),
    { provide: PASSKEY_OPTIONS, useValue: passkeys },
    ...unbindProviders(database, ids),
    ...enrolProviders(database, ids, passkeys),
    ...scheduleProviders(database, ids),
    ...leaveProviders(database, ids),
    ...salaryProviders(database, ids),
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
