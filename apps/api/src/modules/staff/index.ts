export { staffControllers, staffProviders } from './staff.module.ts';
export type { SalaryChanged, EmployeeDocumentRecorded } from './events/published.ts';
export type {
  EmployeeImported,
  ImportCommitted,
  EmployeeImportCommitRequested,
} from './events/published.ts';
export type {
  LeaveRequested,
  LeaveCancelled,
  LeaveApproved,
  LeaveRejected,
  LeaveRevoked,
} from './events/published.ts';

export { createPersonalEligibility } from './persistence/personal-employee.ts';
export { lockEmployeeForUpdate } from './persistence/lock-employee.ts';
export { employeeExistsInBusiness } from './persistence/employee-exists.ts';
export { readCommissionPlanEmployeeNames } from './persistence/commission-plan-employee-names.ts';
export { employeeNamesByUser } from './persistence/employee-names.ts';
export { createActivePasskeyBindings } from './queries/active-passkey-bindings.query.ts';
export type { AttendanceChangeRequested, AttendanceChangeDecided } from './events/published.ts';
import { createSessionReaders } from './persistence/session-readers.ts';
import {
  sessionPerformerOptionsPage,
  sessionPerformerWarningColumns,
} from './queries/session-performer-options.query.ts';
export const { readSessionPerformers, readSessionPerformerOptions } = createSessionReaders({
  page: sessionPerformerOptionsPage,
  warningColumns: sessionPerformerWarningColumns,
});

export { readOwnEmployee } from './persistence/own-employee.ts';
