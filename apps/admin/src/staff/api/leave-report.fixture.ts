import type {
  EmployeeListItem,
  EmployeePage,
  LeaveHistoryReportStatus,
  WorkspaceBranch,
} from '@pospay/contracts';
import { errorMessages, type ErrorMessageCode } from '@pospay/i18n';
import { leaveId } from './leave-decision.fixture';
import { historyPage } from './leave-history.fixture';

export const reportBranchId = '01920000-0000-7000-8000-000000000a02';
export const reportId = '01920000-0000-7000-8000-000000000a03';
export const nextReportId = '01920000-0000-7000-8000-000000000a04';

export const branches: WorkspaceBranch[] = [
  {
    id: leaveId,
    name_ar: null,
    name_en: 'Synthetic branch',
    is_active: true,
    effective_timezone: 'Asia/Kuwait',
  },
  {
    id: reportBranchId,
    name_ar: null,
    name_en: 'Second synthetic branch',
    is_active: true,
    effective_timezone: 'Asia/Kuwait',
  },
];

type ReadyReport = Extract<LeaveHistoryReportStatus, { status: 'ready' }>;
type PendingReport = Extract<LeaveHistoryReportStatus, { status: 'pending' }>;
type FailedReport = Extract<LeaveHistoryReportStatus, { status: 'failed' }>;

export type ReportFailureCode = FailedReport['error']['code'];

export function employeeListItem(overrides: Partial<EmployeeListItem> = {}): EmployeeListItem {
  return {
    id: leaveId,
    name_ar: null,
    name_en: 'Synthetic employee',
    role_code: 'staff',
    primary_branch_id: leaveId,
    hire_date: '2026-01-01',
    employee_number: 1,
    ...overrides,
  };
}

export function employeesPage(items: EmployeeListItem[]): EmployeePage {
  return { items, next_cursor: null };
}

export function readyReport(overrides: Partial<Omit<ReadyReport, 'status'>> = {}): ReadyReport {
  return {
    ...historyPage(),
    ...overrides,
    status: 'ready',
    computed_at: '2026-10-24T09:00:00.000Z',
  };
}

export function pendingReport(): PendingReport {
  return { status: 'pending' };
}

export function failedReport(code: ReportFailureCode): FailedReport {
  const messages = errorMessages(code);
  return {
    status: 'failed',
    error: { code, message_ar: messages.message_ar, message_en: messages.message_en },
  };
}

export function envelopeFailure(status: number, code: ErrorMessageCode) {
  const messages = errorMessages(code);
  return {
    error: { code, message_ar: messages.message_ar, message_en: messages.message_en },
    response: { status },
  };
}

export function requiredRefusal() {
  return envelopeFailure(422, 'LEAVE_HISTORY_REPORT_REQUIRED');
}
