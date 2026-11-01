import { orderSchemas } from './orders/openapi-schemas.js';
import { employeeIbanSchemas } from './staff/employee-iban.js';
import { commissionSchemas } from './commissions/openapi.js';
import { unbindPasskeySchemas } from './staff/unbind-passkey.js';
import { leaveSchemas } from './staff/leave.js';
import { employeeDocumentSchemas } from './staff/employee-documents.js';
import { leaveDecisionSchemas } from './staff/leave-decision.js';
import { attendanceExceptionSchemas } from './staff/attendance-exception.js';
import { attendanceCorrectionSchemas } from './staff/attendance-correction.js';
import { attendanceChangeSchemas } from './staff/attendance-change-request.js';
import { passkeySchemas } from './staff/passkeys.js';
import { clockAttendanceSchemas } from './staff/clock-attendance.js';
import { clockByCardSchemas } from './staff/clock-by-card.js';
import { employeeCardSchemas } from './staff/employee-cards.js';
import { scheduleSchemas } from './staff/schedules.js';
import {
  setSalaryInput,
  employeeSalary,
  salaryHistoryQuery,
  salaryHistoryPage,
  salaryChanged,
} from './staff/salary.js';
import { alertRuleSchemas } from './settings/alert-rules-openapi.js';
import { staffColumnsSchemas } from './settings/staff-columns-openapi.js';
import { fileSchemas } from './files-openapi.js';
import {
  employee,
  createdEmployee,
  createEmployeeInput,
  employeeRoleCode,
  employeeDate,
} from './staff/employee.js';
import {
  employeeImportColumn,
  employeeImportErrorCode,
  employeeImportRowError,
  employeeImportTemplate,
  previewEmployeeImportInput,
  employeeImportPreview,
  commitEmployeeImportInput,
  employeeImportCommit,
  employeeImportCommitAccepted,
  employeeImportStatus,
} from './staff/employee-import.js';
import {
  updateEmployeeInput,
  employeeDetailRecord,
  employeeListItem,
  employeePage,
  employeeListQuery,
} from './staff/update-employee.js';
import { permissionSchemas } from './identity/permissions-openapi.js';
import { pendingDevicesSchemas } from './identity/devices-openapi.js';
import { customerSchemas } from './customers.js';
import { ratingSettingsSchemas } from './customers/rating-settings-openapi.js';
import { ratingView, submitRatingInput } from './customers/ratings.js';
import { catalogSchemas } from './catalog/catalog-openapi.js';
import { attendanceQrToken, attendanceQrBranch, attendanceQrIssue } from './staff/attendance-qr.js';
import {
  staffOtpRequestInput,
  staffOtpVerifyInput,
  staffOtpAcknowledgement,
  staffSessionContext,
  signOutResult,
  staffPinInput,
  staffPinResetInput,
} from './identity/staff-otp.js';
import { errorEnvelope } from './errors/envelope.js';
import { cashierPinVerified, verifyCashierPinInput } from './identity/cashier-pin.js';
import { myMembership, myMembershipsResponse } from './identity/my-memberships.js';
import {
  myWorkspacesResponse,
  workspaceBranch,
  workspaceBusiness,
  workspaceCompany,
} from './identity/workspaces.js';
import {
  claimDeviceInput,
  deviceIdentity,
  deviceRegistration,
  deviceToken,
  pairingCode,
  registerDeviceInput,
} from './identity/devices.js';
import { pageQuery } from './pagination/cursor.js';
import { deliveryLogItem, deliveryLogPage, deliveryLogQuery } from './notifications.js';
import {
  inAppNotification,
  inAppNotificationPage,
  inAppNotificationQuery,
  notificationUnreadCount,
  notificationReadResult,
} from './in-app-notifications.js';
import {
  pushConfig,
  pushEndpoint,
  pushRevokeInput,
  pushSubscriptionInput,
} from './push-subscription.js';
import {
  businessIdentity,
  businessIdentityNames,
  businessLogo,
  businessSettings,
  identityCapability,
  calendar,
  language,
  setBusinessLogoInput,
  taxRule,
  updateBusinessIdentityNamesInput,
  updateBusinessSettingsInput,
} from './settings/business-settings.js';
import { currency } from './reference/currency.js';
import { timeZone } from './reference/time-zone.js';
import { business, createBusinessInput, verticalType } from './tenancy/business.js';
import { branch, createBranchInput, geo } from './tenancy/branch.js';
import { company, createCompanyInput } from './tenancy/company.js';
import { openingHours } from './tenancy/opening-hours.js';
import { plan } from './tenancy/plan.js';
import {
  whatsappEnvelope,
  whatsappHandshake,
  whatsappWebhookAcknowledgement,
} from './whatsapp-webhook.js';

// التجميع مستقل عن المسارات، وترتيب السكيما يحفظ تسجيل المراجع المشتركة ووثيقة OpenAPI الحالية.
export const openApiSchemas = [
  ...employeeIbanSchemas,
  ...commissionSchemas,
  ...employeeDocumentSchemas,
  ...clockAttendanceSchemas,
  ...clockByCardSchemas,
  ...employeeCardSchemas,
  ...leaveSchemas,
  ...leaveDecisionSchemas,
  ...attendanceExceptionSchemas,
  ...attendanceCorrectionSchemas,
  ...attendanceChangeSchemas,
  ...passkeySchemas,
  ...unbindPasskeySchemas,
  ...scheduleSchemas,
  setSalaryInput,
  employeeSalary,
  salaryHistoryQuery,
  salaryHistoryPage,
  salaryChanged,
  updateEmployeeInput,
  employeeDetailRecord,
  employeeListItem,
  employeePage,
  employeeListQuery,
  ...permissionSchemas,
  ...pendingDevicesSchemas,
  ...fileSchemas,
  ...staffColumnsSchemas,
  employee,
  createdEmployee,
  createEmployeeInput,
  employeeRoleCode,
  employeeDate,
  employeeImportColumn,
  employeeImportErrorCode,
  employeeImportRowError,
  employeeImportTemplate,
  previewEmployeeImportInput,
  employeeImportPreview,
  commitEmployeeImportInput,
  employeeImportCommit,
  employeeImportCommitAccepted,
  employeeImportStatus,
  ...customerSchemas,
  ratingView,
  submitRatingInput,
  ...catalogSchemas,
  ...alertRuleSchemas,
  ...ratingSettingsSchemas,
  ...orderSchemas,
  attendanceQrToken,
  attendanceQrBranch,
  attendanceQrIssue,
  staffPinInput,
  staffPinResetInput,
  staffOtpRequestInput,
  staffOtpVerifyInput,
  staffOtpAcknowledgement,
  staffSessionContext,
  signOutResult,
  whatsappWebhookAcknowledgement,
  whatsappEnvelope,
  whatsappHandshake,
  inAppNotification,
  inAppNotificationPage,
  inAppNotificationQuery,
  notificationUnreadCount,
  notificationReadResult,
  pushConfig,
  pushEndpoint,
  pushRevokeInput,
  pushSubscriptionInput,
  deliveryLogItem,
  deliveryLogPage,
  deliveryLogQuery,
  errorEnvelope,
  pageQuery,
  plan,
  company,
  createCompanyInput,
  business,
  createBusinessInput,
  branch,
  createBranchInput,
  pairingCode,
  registerDeviceInput,
  deviceRegistration,
  claimDeviceInput,
  deviceToken,
  deviceIdentity,
  verifyCashierPinInput,
  cashierPinVerified,
  myMembership,
  myMembershipsResponse,
  myWorkspacesResponse,
  workspaceBranch,
  workspaceBusiness,
  workspaceCompany,
  businessIdentity,
  businessIdentityNames,
  businessLogo,
  businessSettings,
  identityCapability,
  setBusinessLogoInput,
  updateBusinessIdentityNamesInput,
  updateBusinessSettingsInput,
  // المكوّنات المتداخلة لازم تتسجل هي كمان، وإلا Zod بيحطها تحت __shared بدل components.
  verticalType,
  currency,
  timeZone,
  geo,
  openingHours,
  language,
  calendar,
  taxRule,
];
