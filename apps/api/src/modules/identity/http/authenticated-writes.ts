// PP-7.2 refused a ban on @Authenticated() writes: a record-scoped or personal decision is not one static
// permission string. createApp refuses a write that is missing from this list, so the session marker alone
// cannot ship. A private method keeps its leading hash; the first # separates the path from the symbol.
export type AuthenticatedWriteAccess = 'RECORD_SCOPED' | 'PERSONAL' | 'DEVICE_ONLY';

export interface AuthenticatedWriteDeclaration {
  readonly access: AuthenticatedWriteAccess;
  readonly checkedIn: string;
}

export type AuthenticatedWriteDeclarations = Readonly<
  Record<string, AuthenticatedWriteDeclaration>
>;

function declared(
  access: AuthenticatedWriteAccess,
  checkedIn: string,
): AuthenticatedWriteDeclaration {
  return Object.freeze({ access, checkedIn });
}

export const AUTHENTICATED_WRITES: Readonly<Record<string, AuthenticatedWriteDeclaration>> =
  Object.freeze({
    'AttendanceChangeRequestsController.decision': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/attendance-change-access.ts#readAttendanceChangeAccess',
    ),
    'AttendanceChangeRequestsController.file': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/attendance-change-access.ts#readAttendanceChangeAccess',
    ),
    'AttendanceChangeRequestsController.withdraw': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/attendance-change-access.ts#readAttendanceChangeAccess',
    ),
    'AttendanceCorrectionsController.correctSession': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/attendance-correction-access.ts#readAttendanceCorrectionAccess',
    ),
    'AttendanceExceptionsController.reopenException': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/attendance-exception-access.ts#readAttendanceExceptionAccess',
    ),
    'AttendanceExceptionsController.resolveException': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/attendance-exception-access.ts#readAttendanceExceptionAccess',
    ),
    'AttendanceQrController.create': declared(
      'DEVICE_ONLY',
      'apps/api/src/modules/staff/http/attendance-qr.controller.ts#create',
    ),
    'BranchScheduleSettingsController.clear': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/schedule-access.ts#scheduleAccess',
    ),
    'BranchScheduleSettingsController.set': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/schedule-access.ts#scheduleAccess',
    ),
    'CashierPinsController.verify': declared(
      'DEVICE_ONLY',
      'apps/api/src/modules/identity/http/cashier-pins.controller.ts#verify',
    ),
    'ClockAttendanceController.challenge': declared(
      'PERSONAL',
      'apps/api/src/shared/personal-session.guard.ts#personalSessionRequest',
    ),
    'ClockAttendanceController.submit': declared(
      'PERSONAL',
      'apps/api/src/shared/personal-session.guard.ts#personalSessionRequest',
    ),
    'ClockByCardController.submit': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/attendance-device-access.ts#readAttendanceDeviceAccess',
    ),
    'EmployeeCardsController.issueCard': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/employee-scope-access.ts#readEmployeeBranchAccess',
    ),
    'EmployeeCardsController.revokeCard': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/employee-scope-access.ts#readEmployeeBranchAccess',
    ),
    'EmployeeDefaultShiftsController.set': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/employee-hours-access.ts#readEmployeeHoursAccess',
    ),
    'EmployeeDocumentsController.add': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/document-access.ts#readDocumentAccess',
    ),
    'EmployeeIbanController.set': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/employee-salary-access.ts#readEmployeeSalaryAccess',
    ),
    'EmployeeImportController.createCommit': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/employee-creation-access.ts#lockEmployeeManagementAccess',
    ),
    'EmployeeImportController.createPreview': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/employee-creation-access.ts#readEmployeeManagementAccess',
    ),
    'EmployeeLeaveController.cancelRequest': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/leave-access.ts#readLeaveAccess',
    ),
    'EmployeeLeaveController.request': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/leave-access.ts#readLeaveAccess',
    ),
    'EmployeePasskeysController.unbind': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/passkey-access.ts#readPasskeyAccess',
    ),
    'EmployeeSalariesController.set': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/employee-salary-access.ts#readEmployeeSalaryAccess',
    ),
    'EmployeesController.create': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/employee-creation-access.ts#lockEmployeeCreationAccess',
    ),
    'EmployeesController.nameMatches': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/employee-scope-access.ts#readEmployeeBranchAccess',
    ),
    'EmployeesController.update': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/employee-scope-access.ts#readEmployeeBranchAccess',
    ),
    'FilesController.confirm': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/files/use-cases/confirm-upload/confirm-upload.ts#ConfirmUpload',
    ),
    'FilesController.download': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/use-cases/authorize-request/authorize-request.ts#AuthorizeRequest',
    ),
    'FilesController.downloadByKey': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/use-cases/authorize-request/authorize-request.ts#AuthorizeRequest',
    ),
    'FilesController.upload': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/use-cases/authorize-request/authorize-request.ts#AuthorizeRequest',
    ),
    'InAppNotificationsController.read': declared(
      'PERSONAL',
      'apps/api/src/modules/notifications/persistence/drizzle-in-app.repository.ts#createInAppRepository',
    ),
    'InAppNotificationsController.readAll': declared(
      'PERSONAL',
      'apps/api/src/modules/notifications/persistence/drizzle-in-app.repository.ts#createInAppRepository',
    ),
    'LeaveDecisionsController.decideRequest': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/leave-access.ts#readLeaveAccess',
    ),
    'LeaveDecisionsController.revokeRequest': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/leave-access.ts#readLeaveAccess',
    ),
    'OwnLeaveController.cancelRequest': declared(
      'PERSONAL',
      'apps/api/src/modules/staff/http/leave-http.ts#ownLeaveActor',
    ),
    'OwnLeaveController.request': declared(
      'PERSONAL',
      'apps/api/src/modules/staff/http/leave-http.ts#ownLeaveActor',
    ),
    'PasskeysController.registrationOptions': declared(
      'PERSONAL',
      'apps/api/src/shared/personal-session.guard.ts#personalSessionRequest',
    ),
    'PasskeysController.verify': declared(
      'PERSONAL',
      'apps/api/src/shared/personal-session.guard.ts#personalSessionRequest',
    ),
    'PersonalOtpController.signOut': declared(
      'PERSONAL',
      'apps/api/src/shared/personal-session.guard.ts#personalSessionRequest',
    ),
    'PushSubscriptionController.register': declared(
      'PERSONAL',
      'apps/api/src/shared/personal-session.guard.ts#personalSessionRequest',
    ),
    'PushSubscriptionController.revoke': declared(
      'PERSONAL',
      'apps/api/src/shared/personal-session.guard.ts#personalSessionRequest',
    ),
    'ScheduleSettingsController.set': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/schedule-access.ts#scheduleAccess',
    ),
    'SchedulesController.set': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/schedule-access.ts#scheduleAccess',
    ),
    'ServiceSessionsController.append': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/service-session-access.ts#readServiceSessionAccess',
    ),
    'ShiftTemplatesController.apply': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/schedule-access.ts#scheduleAccess',
    ),
    'ShiftTemplatesController.archive': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/schedule-access.ts#scheduleAccess',
    ),
    'ShiftTemplatesController.create': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/schedule-access.ts#scheduleAccess',
    ),
    'ShiftTemplatesController.update': declared(
      'RECORD_SCOPED',
      'apps/api/src/modules/identity/persistence/schedule-access.ts#scheduleAccess',
    ),
    'StaffOtpController.request': declared(
      'DEVICE_ONLY',
      'apps/api/src/shared/session.guard.ts##staff',
    ),
    'StaffOtpController.signOut': declared(
      'PERSONAL',
      'apps/api/src/shared/session.guard.ts##staff',
    ),
    'StaffOtpController.verify': declared(
      'DEVICE_ONLY',
      'apps/api/src/shared/session.guard.ts##staff',
    ),
    'StaffPinController.signIn': declared(
      'DEVICE_ONLY',
      'apps/api/src/shared/session.guard.ts##staff',
    ),
  });
