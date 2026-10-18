import { expect, it } from 'vitest';
import { hasNestedSchema, hasNestedValue, hasUnknown, inject, validSample } from './__tests__/response-sample.js';
import { createServiceInput, service, servicePage } from './catalog/service.js';
import { packageServiceOptionPage } from './catalog/package-service-option.js';
import { createPackageTypeInput, packageTypeDetail, packageTypePage } from './catalog/package-type.js';
import { customer, findOrCreateCustomerInput } from './customers.js';
import { errorEnvelope } from './errors/envelope.js';
import { fileConfirmation, fileDownload, fileStatus, fileUploadTicket, requestFileUpload } from './files.js';
import { discountLimit, discountLimitInput } from './identity/discount-limit.js';
import { membershipPermissions, permissionMembershipPage, permissionOverride, permissionOverrideInput } from './identity/permissions.js';
import { myWorkspacesResponse, workspaceCompany } from './identity/workspaces.js';
import { inAppNotificationPage, inAppRecipient, notificationReadResult, notificationUnreadCount } from './in-app-notifications.js';
import {
  appendServiceSessionLinesResponse,
  editServiceLineResponse,
  recordServiceSessionInput,
  recordServiceSessionResponse,
} from './orders/service-session.js';
import { serviceSessionDayPage, serviceSessionDayQuery } from './orders/service-session-day.js';
import { serviceLineEditsPage, serviceLineEditsQuery } from './orders/service-session-edits.js';
import { sessionPerformerOptionPage, sessionServiceOptionPage, sessionServiceOptionsQuery } from './orders/service-session-options.js';
import { confirmSessionRecoveryBody, serviceSessionRecoveryPage } from './orders/service-session-recovery.js';
import { recordingContext, recordingContextQuery } from './orders/recording-context.js';
import { businessSettings, updateBusinessSettingsInput } from './settings/business-settings.js';
import { attendanceBoard, attendanceBoardQuery } from './staff/attendance-board.js';
import { attendanceCapabilities } from './staff/attendance-capabilities.js';
import { attendanceChangeDecisionResult, attendanceChangeRequest, attendanceChangeRequestInput, attendanceChangeRequestPage } from './staff/attendance-change-request.js';
import { correctAttendanceInput, correctAttendanceResult } from './staff/attendance-correction.js';
import { attendanceDeviceRefusalPage } from './staff/attendance-device-refusals.js';
import { attendanceEmployeePage, attendanceEmployeesQuery } from './staff/attendance-employees.js';
import { attendanceExceptionDecisionInput, attendanceExceptionRecord } from './staff/attendance-exception.js';
import { attendanceCorrectionHistory, attendanceExceptionPage, attendanceExceptionsListQuery } from './staff/attendance-actions-read.js';
import { attendanceMonthlyReport, attendanceMonthlyReportQuery } from './staff/attendance-monthly-report.js';
import { attendanceQrIssue, attendanceQrToken } from './staff/attendance-qr.js';
import { clockAttendanceInput, clockAttendanceResult } from './staff/clock-attendance.js';
import { createEmployeeInput, employee } from './staff/employee.js';
import { employeeCard, employeeCardsView, issueEmployeeCardInput } from './staff/employee-cards.js';
import { employeeDefaultShifts, setEmployeeDefaultShiftsInput } from './staff/employee-default-shifts.js';
import { employeeDetailRecord, employeePage } from './staff/update-employee.js';
import { documentType, documentTypeList, employeeDocument, employeeDocumentsView, recordEmployeeDocumentInput } from './staff/employee-documents.js';
import { employeeIbanHistoryPage, employeeIbanView, setEmployeeIbanInput } from './staff/employee-iban.js';
import { employeeImportCommitAccepted, employeeImportPreview, employeeImportStatus, employeeImportTemplate, previewEmployeeImportInput } from './staff/employee-import.js';
import { employeeNameMatches, employeeNameMatchesInput } from './staff/employee-name-matches.js';
import { leavePage, leaveRequest, requestLeaveInput } from './staff/leave.js';
import { employeeSalary, salaryHistoryPage, setSalaryInput } from './staff/salary.js';
import { scheduleGrid, setScheduleInput, staffSchedule } from './staff/schedules.js';
import { branchScheduleSettings, scheduleSettings, setScheduleSettingsInput } from './staff/schedule-settings.js';
import { employeePasskeyHistory, passkeyEmployeePage, unbindPasskeyInput, unboundPasskey } from './staff/unbind-passkey.js';
const responses = [
  { name: 'appendServiceSessionLinesResponse', schema: appendServiceSessionLinesResponse },
  { name: 'attendanceBoard', schema: attendanceBoard },
  { name: 'attendanceCapabilities', schema: attendanceCapabilities },
  { name: 'attendanceChangeDecisionResult', schema: attendanceChangeDecisionResult },
  { name: 'attendanceChangeRequest', schema: attendanceChangeRequest },
  { name: 'attendanceChangeRequestPage', schema: attendanceChangeRequestPage },
  { name: 'attendanceCorrectionHistory', schema: attendanceCorrectionHistory },
  { name: 'attendanceDeviceRefusalPage', schema: attendanceDeviceRefusalPage },
  { name: 'attendanceEmployeePage', schema: attendanceEmployeePage },
  { name: 'attendanceExceptionPage', schema: attendanceExceptionPage },
  { name: 'attendanceExceptionRecord', schema: attendanceExceptionRecord },
  { name: 'attendanceMonthlyReport', schema: attendanceMonthlyReport },
  { name: 'branchScheduleSettings', schema: branchScheduleSettings },
  { name: 'businessSettings', schema: businessSettings },
  { name: 'clockAttendanceResult', schema: clockAttendanceResult },
  { name: 'correctAttendanceResult', schema: correctAttendanceResult },
  { name: 'customer', schema: customer },
  { name: 'discountLimit', schema: discountLimit },
  { name: 'documentType', schema: documentType },
  { name: 'documentTypeList', schema: documentTypeList },
  { name: 'editServiceLineResponse', schema: editServiceLineResponse },
  { name: 'employee', schema: employee },
  { name: 'employeeCard', schema: employeeCard },
  { name: 'employeeCardsView', schema: employeeCardsView },
  { name: 'employeeDefaultShifts', schema: employeeDefaultShifts },
  { name: 'employeeDetailRecord', schema: employeeDetailRecord },
  { name: 'employeeDocument', schema: employeeDocument },
  { name: 'employeeDocumentsView', schema: employeeDocumentsView },
  { name: 'employeeIbanHistoryPage', schema: employeeIbanHistoryPage },
  { name: 'employeeIbanView', schema: employeeIbanView },
  { name: 'employeeImportCommitAccepted', schema: employeeImportCommitAccepted },
  { name: 'employeeImportPreview', schema: employeeImportPreview },
  { name: 'employeeImportStatus', schema: employeeImportStatus },
  { name: 'employeeImportTemplate', schema: employeeImportTemplate },
  { name: 'employeeNameMatches', schema: employeeNameMatches },
  { name: 'employeePage', schema: employeePage },
  { name: 'employeePasskeyHistory', schema: employeePasskeyHistory },
  { name: 'employeeSalary', schema: employeeSalary },
  { name: 'errorEnvelope', schema: errorEnvelope },
  { name: 'fileDownload', schema: fileDownload },
  { name: 'fileStatus', schema: fileStatus },
  { name: 'fileConfirmation', schema: fileConfirmation },
  { name: 'leavePage', schema: leavePage },
  { name: 'leaveRequest', schema: leaveRequest },
  { name: 'membershipPermissions', schema: membershipPermissions },
  { name: 'myWorkspacesResponse', schema: myWorkspacesResponse },
  { name: 'packageServiceOptionPage', schema: packageServiceOptionPage },
  { name: 'packageTypeDetail', schema: packageTypeDetail },
  { name: 'packageTypePage', schema: packageTypePage },
  { name: 'passkeyEmployeePage', schema: passkeyEmployeePage },
  { name: 'permissionMembershipPage', schema: permissionMembershipPage },
  { name: 'permissionOverride', schema: permissionOverride },
  { name: 'recordingContext', schema: recordingContext },
  { name: 'recordServiceSessionResponse', schema: recordServiceSessionResponse },
  { name: 'salaryHistoryPage', schema: salaryHistoryPage },
  { name: 'scheduleGrid', schema: scheduleGrid },
  { name: 'scheduleSettings', schema: scheduleSettings },
  { name: 'service', schema: service },
  { name: 'servicePage', schema: servicePage },
  { name: 'serviceLineEditsPage', schema: serviceLineEditsPage },
  { name: 'serviceSessionDayPage', schema: serviceSessionDayPage },
  { name: 'serviceSessionRecoveryPage', schema: serviceSessionRecoveryPage },
  { name: 'sessionPerformerOptionPage', schema: sessionPerformerOptionPage },
  { name: 'sessionServiceOptionPage', schema: sessionServiceOptionPage },
  { name: 'staffSchedule', schema: staffSchedule },
  { name: 'unboundPasskey', schema: unboundPasskey },
  { name: 'workspaceCompany', schema: workspaceCompany },
];

const requests = [
  { name: 'sessionServiceOptionsQuery', schema: sessionServiceOptionsQuery },
  { name: 'recordServiceSessionInput', schema: recordServiceSessionInput },
  { name: 'createServiceInput', schema: createServiceInput },
  { name: 'attendanceQrToken', schema: attendanceQrToken },
  { name: 'attendanceQrIssue', schema: attendanceQrIssue },
  { name: 'clockAttendanceInput', schema: clockAttendanceInput },
  { name: 'findOrCreateCustomerInput', schema: findOrCreateCustomerInput },
  { name: 'discountLimitInput', schema: discountLimitInput },
  { name: 'requestFileUpload', schema: requestFileUpload },
  { name: 'recordingContextQuery', schema: recordingContextQuery },
  { name: 'serviceSessionDayQuery', schema: serviceSessionDayQuery },
  { name: 'serviceLineEditsQuery', schema: serviceLineEditsQuery },
  { name: 'confirmSessionRecoveryBody', schema: confirmSessionRecoveryBody },
  { name: 'createPackageTypeInput', schema: createPackageTypeInput },
  { name: 'attendanceBoardQuery', schema: attendanceBoardQuery },
  { name: 'attendanceExceptionsListQuery', schema: attendanceExceptionsListQuery },
  { name: 'attendanceExceptionDecisionInput', schema: attendanceExceptionDecisionInput },
  { name: 'attendanceEmployeesQuery', schema: attendanceEmployeesQuery },
  { name: 'correctAttendanceInput', schema: correctAttendanceInput },
  { name: 'attendanceMonthlyReportQuery', schema: attendanceMonthlyReportQuery },
  { name: 'attendanceChangeRequestInput', schema: attendanceChangeRequestInput },
  { name: 'issueEmployeeCardInput', schema: issueEmployeeCardInput },
  { name: 'createEmployeeInput', schema: createEmployeeInput },
  { name: 'setEmployeeDefaultShiftsInput', schema: setEmployeeDefaultShiftsInput },
  { name: 'permissionOverrideInput', schema: permissionOverrideInput },
  { name: 'updateBusinessSettingsInput', schema: updateBusinessSettingsInput },
  { name: 'setSalaryInput', schema: setSalaryInput },
  { name: 'setScheduleSettingsInput', schema: setScheduleSettingsInput },
  { name: 'setScheduleInput', schema: setScheduleInput },
  { name: 'employeeNameMatchesInput', schema: employeeNameMatchesInput },
  { name: 'recordEmployeeDocumentInput', schema: recordEmployeeDocumentInput },
  { name: 'setEmployeeIbanInput', schema: setEmployeeIbanInput },
  { name: 'previewEmployeeImportInput', schema: previewEmployeeImportInput },
  { name: 'requestLeaveInput', schema: requestLeaveInput },
  { name: 'unbindPasskeyInput', schema: unbindPasskeyInput },
  { name: 'inAppRecipient', schema: inAppRecipient },
];

it.each(responses)('$name drops an unknown key at the top and inside a nested object', ({ schema }) => {
  const clean = validSample(schema);
  if (hasNestedSchema(schema)) expect(hasNestedValue(clean)).toBe(true);
  const parsed = schema.safeParse(inject(clean));
  expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error?.issues)).toBe(true);
  if (!parsed.success) return;
  expect(hasUnknown(parsed.data)).toBe(false);
  expect(parsed.data).toEqual(schema.parse(clean));
});

// معاملات القوالب (safe_parameters) tuples مكتوبة؛ وبتفضل strict عشان نوع العميل يفضل tuple. الغلاف والصفحة بيشيلوا المفتاح الزيادة.
it.each([
  { name: 'inAppNotificationPage', schema: inAppNotificationPage },
  { name: 'notificationReadResult', schema: notificationReadResult },
  { name: 'notificationUnreadCount', schema: notificationUnreadCount },
])('$name drops an unknown key at the top and on each notification envelope', ({ schema }) => {
  const clean = validSample(schema) as Record<string, unknown>;
  const items = Array.isArray(clean['items']) ? (clean['items'] as Record<string, unknown>[]).map((item) => ({ ...item, __unknown: true })) : undefined;
  const parsed = schema.safeParse({ ...clean, ...(items ? { items } : {}), __unknown: true });
  expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error?.issues)).toBe(true);
  if (!parsed.success) return;
  expect(JSON.stringify(parsed.data)).not.toContain('__unknown');
  expect(parsed.data).toEqual(schema.parse(clean));
});

// الهيدرز المرتدة للتخزين بتعدّي زي ما هي (ممكن يتضاف هيدر موقّع)؛ الغلاف بيشيل المفتاح الزيادة.
it('fileUploadTicket drops an unknown top-level key but passes extra upload headers through', () => {
  const clean = validSample(fileUploadTicket) as Record<string, unknown>;
  const headers = { ...(clean['headers'] as Record<string, string>), 'x-amz-checksum-sha256': 'abc' };
  const parsed = fileUploadTicket.parse({ ...clean, headers, __unknown: true });
  expect(JSON.stringify(parsed)).not.toContain('__unknown');
  expect((parsed.headers as Record<string, string>)['x-amz-checksum-sha256']).toBe('abc');
});

it.each(requests)('$name still rejects an unknown key', ({ schema }) => {
  const clean = validSample(schema);
  const parsed = schema.safeParse({ ...(clean as Record<string, unknown>), __unknown: true });
  expect(parsed.success).toBe(false);
  if (parsed.success) return;
  expect(JSON.stringify(parsed.error.issues)).toContain('unrecognized_keys');
});
