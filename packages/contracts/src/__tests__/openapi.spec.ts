import { describe, expect, it } from 'vitest';

import committed from '../../openapi/openapi.json' with { type: 'json' };
import { buildOpenApiDocument } from '../openapi.js';

const expectedSchemas = [
  'SessionPerformerOptionsQuery', 'SessionPerformerOption', 'SessionPerformerOptionPage',
  'SessionServiceOptionsQuery', 'SessionServiceOption', 'SessionServiceOptionPage',
  'RecordingContext', 'RecordingContextQuery', 'RecordingDiscountLimit',
  'SessionMoney', 'SessionPerformerInput', 'SessionLineInput', 'RecordServiceSessionInput',
  'AppendServiceSessionLinesInput', 'SessionPerformer', 'SavedServiceLine', 'ServiceSession',
  'EditServiceLineInput', 'EditServiceLineResponseFull', 'EditServiceLineResponseNarrow', 'EditServiceLineResponse',
  'RejectedServiceLine', 'RecordServiceSessionResponse', 'AppendServiceSessionLinesResponse',
  'ServiceLineChanged', 'RecordedServiceLine', 'ServiceSessionRecorded', 'ServiceSessionLinesAdded', 'LateServiceSessionNoticeRequested', 'ServiceLineEditNoticeRequested', 'ServiceLineCancelNoticeRequested', 'ServiceLinePerformersNoticeRequested',
  'SessionTipEntry', 'RecordSessionTipsInput', 'SessionTips', 'SessionTipsChanged',
  'CreateDocumentTypeInput',
  'DocumentType',
  'DocumentTypeList',
  'DocumentTypeRevisionInput',
  'EmployeeDocument',
  'EmployeeDocumentStatus',
  'EmployeeDocumentsView',
  'RecordEmployeeDocumentInput',
  'UpdateDocumentTypeInput',
  'AttendanceInstallationSignal',
  'AttendanceDeviceRefusal',
  'AttendanceDeviceRefusalPage',
  'EmployeePasskeyHistory',
  'PasskeyEmployee',
  'PasskeyEmployeePage',
  'PasskeyHistoryEntry',
  'PasskeyHistoryQuery',
  'UnbindPasskeyInput',
  'UnboundPasskey',
  'CancelLeaveInput',
  'DecideLeaveInput',
  'RevokeLeaveInput',
  'LeaveInboxQuery',
  'LeaveListItem',
  'LeaveListQuery',
  'LeavePage',
  'LeaveRequest',
  'RequestEmployeeLeaveInput',
  'RequestLeaveInput',
  'ApplyTemplateInput',
  'ApplyTemplateResult',
  'ArchiveTemplateInput',
  'ConcreteShift',
  'ScheduleGrid',
  'ScheduleGridRow',
  'ScheduleListQuery',
  'SchedulePattern',
  'ScheduleSettings',
  'ScheduleShift',
  'ScheduleWeekQuery',
  'ScheduleWeekResult',
  'SetScheduleInput',
  'SetScheduleSettingsInput',
  'ShiftTemplate',
  'StaffSchedule',
  'TemplateListQuery',
  'TemplatePage',
  'TemplateTerms',
  'UpdateTemplateInput',
  'AttendanceQrBranch',
  'AttendanceQrIssue',
  'AttendanceQrToken',
  'Branch',
  'Business',
  'BusinessSettings',
  'Calendar',
  'CashierPinVerified',
  'ClaimDeviceInput',
  'ClockAttendanceInput',
  'ClockAttendanceResult',
  'ClockByCardInput',
  'ClockChallenge',
  'ClockChallengeInput',
  'Company',
  'CreateBranchInput',
  'CreateBusinessInput',
  'CreateCompanyInput',
  'CreateEmployeeInput',
  'CreateServiceInput',
  'Service',
  'ServiceCommissionRule',
  'ServiceListItem',
  'ServiceListQuery',
  'ServicePage',
  'ServicePrice',
  'UpdateServiceInput',
  'Currency',
  'Customer',
  'DeliveryLogItem',
  'DeliveryLogPage',
  'DeliveryLogQuery',
  'DeviceIdentity',
  'DeviceRegistration',
  'DeviceToken',
  'DiscountLimit',
  'DiscountLimitInput',
  'CreatedEmployee',
  'Employee',
  'EmployeeCard',
  'EmployeeCardsView',
  'EmployeeDate',
  'EmployeeDetail',
  'EmployeeListItem',
  'EmployeeListQuery',
  'EmployeePage',
  'EmployeeRoleCode',
  'ErrorEnvelope',
  'FileConfirmation',
  'FileDownload',
  'FileDownloadByKey',
  'FileStatus',
  'FileUploadTicket',
  'FindOrCreateCustomerInput',
  'GeoPoint',
  'InAppNotification',
  'InAppNotificationPage',
  'InAppNotificationQuery',
  'Language',
  'MembershipPageQuery',
  'MembershipPermissions',
  'MembershipPermissionsQuery',
  'MyWorkspacesResponse',
  'NotificationReadResult',
  'NotificationUnreadCount',
  'OpeningHours',
  'PageQuery',
  'PairingCode',
  'PasskeyBindingStatus',
  'PasskeyRegistrationOptions',
  'PasskeyOptionsInput',
  'PasskeyVerifyInput',
  'PersonalOtpRequestInput',
  'PersonalOtpVerifyInput',
  'PersonalSchedule',
  'PersonalSessionContext',
  'PermissionMembership',
  'PermissionMembershipPage',
  'PermissionOverride',
  'PermissionOverrideInput',
  'PermissionOverridePage',
  'Plan',
  'RegisterDeviceInput',
  'RequestFileUpload',
  'RevokePermissionOverrideInput',
  'StaffOtpAcknowledgement',
  'StaffOtpRequestInput',
  'StaffOtpVerifyInput',
  'StaffPinInput',
  'StaffPinResetInput',
  'StaffSessionContext',
  'TaxRule',
  'TimeZone',
  'UpdateBusinessSettingsInput',
  'UpdateEmployeeInput',
  'VerifyCashierPinInput',
  'VerticalType',
  'WhatsappEnvelope',
  'WhatsappHandshake',
  'WhatsappWebhookAcknowledgement',
  'WorkspaceBranch',
  'WorkspaceBusiness',
  'WorkspaceCompany',
  'CommitEmployeeImportInput',
  'EmployeeImportColumn',
  'EmployeeImportCommit',
  'EmployeeImportCommitAccepted',
  'EmployeeImportStatus',
  'EmployeeImportErrorCode',
  'EmployeeImportPreview',
  'EmployeeImportRowError',
  'EmployeeImportTemplate',
  'PreviewEmployeeImportInput',
  'IssueEmployeeCardInput',
  'ConfirmSessionRecoveryBody',
  'ServiceSessionRecoveryAttempt',
  'ServiceSessionRecoveryLine',
  'ServiceSessionRecoveryOperation',
  'ServiceSessionRecoveryPage',
  'ServiceSessionRecoveryQuery',
  'ServiceSessionRecoveryVisit',
  'AttendanceExceptionDecisionInput',
  'AttendanceExceptionRecord',
  'CorrectAttendanceInput',
  'CorrectAttendanceResult',
].sort();

describe('openapi/openapi.json', () => {
  it('matches the contracts — run `pnpm contracts:openapi` after changing a schema', () => {
    expect(buildOpenApiDocument()).toEqual(committed);
  });

  it('publishes every schema with no $id inside a component', () => {
    const schemas = (buildOpenApiDocument()['components'] as { schemas: Record<string, object> })
      .schemas;
    expect(Object.keys(schemas).sort()).toEqual(
      [
        ...expectedSchemas,
        'ServiceSessionDayQuery',
        'ServiceSessionDayPerformer',
        'ServiceSessionDayLine',
        'ServiceSessionDayItem',
        'ServiceSessionDayPage',
        'AttendanceChangeDecisionResult',
        'AttendanceChangeListQuery',
        'AttendanceChangeRequest',
        'AttendanceChangeRequestInput',
        'AttendanceChangeRequestPage',
        'CancelAttendanceChangeInput',
        'DecideAttendanceChangeInput',
        'EmployeeSalary',
        'SalaryHistoryPage',
        'SalaryHistoryQuery',
        'SetSalaryInput',
        'SetEmployeeIbanInput',
        'EmployeeIbanView',
        'EmployeeIbanHistoryQuery',
        'EmployeeIbanHistoryEntry',
        'EmployeeIbanHistoryPage',
        'PackageTypeComponentInput',
        'CreatePackageTypeInput',
        'UpdatePackageTypeInput',
        'PackageTypeComponent',
        'PackageTypeDetail',
        'PackageTypeListItem',
        'PackageTypePage',
        'PackageTypeListQuery',
        'PackageServiceOption',
        'PackageServiceOptionPage',
      ].sort(),
    );
    for (const schema of Object.values(schemas)) {
      expect(schema).not.toHaveProperty('$id');
    }
  });

  it('publishes currency and timezone as closed enums, so generated clients reject unknown values', () => {
    const schemas = (
      buildOpenApiDocument()['components'] as { schemas: Record<string, { enum?: string[] }> }
    ).schemas;
    expect(schemas['Currency']?.enum).toContain('KWD');
    expect(schemas['Currency']?.enum).not.toContain('ZZZ');
    expect(schemas['TimeZone']?.enum).toContain('Asia/Kuwait');
    expect(schemas['TimeZone']?.enum).not.toContain('Asia/Atlantis');
  });
});

it('keeps change off a recorded line and optional on a changed line', () => {
  const schemas = (
    buildOpenApiDocument()['components'] as {
      schemas: Record<string, { properties?: Record<string, unknown>; required?: string[] }>;
    }
  ).schemas;
  const recorded = schemas['RecordedServiceLine'];
  const changed = schemas['ServiceLineChanged'];
  expect(recorded?.properties).not.toHaveProperty('change');
  expect(JSON.stringify(recorded)).not.toContain('"not"');
  expect(changed?.properties).toHaveProperty('change');
  expect(changed?.required ?? []).not.toContain('change');
});

it('publishes both change kinds of a changed line', () => {
  const document = JSON.stringify(buildOpenApiDocument());
  expect(document).toContain('PRICE_DISCOUNT_EDIT');
  expect(document).toContain('LINE_CANCELLED');
  expect(document).toContain('PERFORMERS_CHANGE');
});
