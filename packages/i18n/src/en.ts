import {
  attendanceActionsEn,
  attendanceBoardEn,
  attendanceReportEn,
} from './attendance-actions-catalog.js';
import { staffDuplicateNameEn } from './staff-duplicate-name-catalog.js';
import { devicesEn } from './devices-catalog.js';
import { staffAccessAdminEn } from './staff-access-admin-catalog.js';
import { attendanceChangeEn } from './attendance-change.js';
import { inAppEn } from './in-app-catalog.js';
import { permissionCodesEn } from './permission-codes-catalog.js';
import { catalogPackageTypesEn, packageTypeErrorsEn } from './catalog-package-types.js';
import { catalogPackageExtensionEn } from './catalog-package-extension.js';
import { catalogPackageRefundEn } from './catalog-package-refund.js';
import { discountApprovalErrorsEn } from './discount-approval-errors.js';
import { staffErrorsEn } from './staff-errors.js';
import { attendanceEn } from './attendance-en.js';
import { clockCardAdminEn } from './clock-card-catalog.js';
import { posEn } from './pos-catalog.js';
import { employeeImportErrorsEn } from './employee-import.js';
import { leaveEn, leaveErrorsEn } from './leave-catalog.js';
import { attendanceExceptionErrorsEn } from './attendance-exception-catalog.js';
import { attendanceCorrectionErrorsEn } from './attendance-correction-catalog.js';
import { employeeDocumentsEn } from './employee-documents-catalog.js';
import { enPasskeyAdmin } from './passkey-admin.js';
import { personalStaffEn } from './personal-staff-catalog.js';
import { salaryEn } from './salary-catalog.js';
import { invitationsEn, invitationErrorsEn } from './invitations-catalog.js';
import { staffLoginEn } from './staff-login-catalog.js';
import { catalogServicesEn, catalogServiceErrorsEn } from './catalog-services.js';
import { serviceImportEn } from './service-import.js';
import { customerImportEn } from './customer-import.js';
import { catalogServiceCategoriesEn } from './catalog-service-categories.js';
import { catalogServiceCategoryBranchesEn } from './catalog-service-category-branches.js';
import { adminEn } from './admin-catalog.js';
import { employeeIbanEn, employeeIbanErrorsEn } from './employee-iban-catalog.js';
import { scheduleShellEn } from './schedule-shell-catalog.js';
import { employeeDefaultHoursEn } from './employee-default-hours-catalog.js';
import { employeeNumberErrorsEn } from './employee-number-catalog.js';
import { employeeNumberAdminEn } from './employee-number-admin-catalog.js';
import { staffScreensEn } from './staff-screens-catalog.js';
import { businessIdentityEn } from './business-identity-catalog.js';
import { roleNamesEn } from './role-names-catalog.js';
import { commissionPlanErrorsEn } from './commission-plan-errors.js';
import { commissionStatementExportErrorsEn } from './commission-statement-export-errors.js';
import { idempotencyErrorsEn } from './idempotency-errors.js';
import { phoneLockEn } from './phone-lock-en.js';
// The English catalog — the reference: every key here must exist in ar.ts (the type makes a missing one a build error).
export const en = {
  attendanceActions: attendanceActionsEn,
  attendanceBoard: attendanceBoardEn,
  attendanceReport: attendanceReportEn,
  phoneLock: phoneLockEn,
  employeeIban: employeeIbanEn,
  employeeDefaultHours: employeeDefaultHoursEn,
  employeeDocuments: employeeDocumentsEn,
  passkeyAdmin: enPasskeyAdmin,
  leave: leaveEn,
  permissionCodes: { ...permissionCodesEn, ...attendanceChangeEn.permissionCodes },
  brand: {
    title: 'PosPay — بوس باي',
    latinName: 'PosPay',
    arabicName: 'بوس باي',
  },
  theme: {
    label: 'Display theme',
    light: 'Light',
    dark: 'Dark',
    system: 'System',
  },
  workspace: { offline: 'Could not load your workspace: no connection.' },
  salary: salaryEn,
  employeeCard: clockCardAdminEn,
  personalAttendance: attendanceEn,
  personalStaff: personalStaffEn,
  shell: {
    ...scheduleShellEn,
    schedule_title: 'Weekly schedules',
    schedule_lead: 'Saturday to Friday in the selected branch timezone.',
    schedule_week: 'Week starts (Saturday)',
    schedule_employee: 'Employee',
    schedule_empty: 'No employees attached during this week.',
    schedule_off: 'No shifts',
    schedule_edit: 'Edit day',
    schedule_editTitle: 'Edit employee schedule',
    schedule_start: 'Start',
    schedule_end: 'End',
    schedule_add: 'Add shift',
    schedule_remove: 'Remove shift',
    schedule_reason: 'Reason',
    schedule_pastReason: 'A reason is required for a past day.',
    schedule_overnight: 'End at or before start means the next day. Maximum 16 hours.',
    schedule_saved: 'Schedule saved.',
    schedule_chooseBranch: 'Choose a branch to view schedules.',
    schedule_previous: 'First page',
    schedule_next: 'Next page',
    schedule_save: 'Save schedule',
    schedule_close: 'Close',
    navigation: 'Workspace navigation',
    openNavigation: 'Open navigation',
    closeNavigation: 'Close navigation',
    account: 'Signed-in account',
    workspaceLead: 'Your company, business and branch at a glance.',
    permissionsLead: 'Review role defaults and manage personal access decisions.',
  },
  roles: roleNamesEn,
  permissions: {
    discountLimit: 'Discount limit (%)',
    businessDiscountTitle: 'Default discount limit',
    businessDiscountLabel: 'Default discount limit (%)',
    businessDiscountLead: 'Used when a person has no personal limit. Active owners have no limit.',
    businessDiscountUnset: 'No business default configured.',
    discountUnset: 'No personal limit set.',
    discountCurrent: 'Current discount limit',
    discountSave: 'Save discount limit',
    discountClear: 'Clear discount limit',
    discountSaved: 'Discount limit saved.',
    discountInvalid: 'Enter a percentage from 0 to 100 with at most two decimals and a reason.',
    view: 'View',
    copyHolder: 'Copy identifier',
    title: 'Permissions',
    person: 'Membership',
    choose: 'Choose a person',
    defaults: 'Role defaults',
    overrides: 'Personal overrides',
    empty: 'No memberships found.',
    noDefaults: 'This role has no seeded defaults.',
    endMembership: 'End membership',
    endMembershipTitle: 'Confirm ending membership',
    endMembershipLead:
      'This membership will end immediately and the member will lose access to this company without affecting their other companies.',
    endMembershipConfirm: 'Confirm end',
    endMembershipCancel: 'Cancel',
    noOverrides: 'No overrides on this page.',
    readOnly: 'You cannot edit this membership’s permissions.',
    history: 'Ended overrides',
    revoke: 'Revoke override',
    revoked: 'Override revoked.',
    permission: 'Permission',
    effect: 'Decision',
    allow: 'Allow',
    deny: 'Deny',
    scope: 'Scope',
    scopeId: 'Scope identifier',
    company: 'Company',
    business: 'Business',
    branch: 'Branch',
    reason: 'Reason',
    expiry: 'Expiry (UTC, optional)',
    expiresAt: 'Expires at',
    save: 'Save override',
    saved: 'Override saved.',
    next: 'Next page',
    first: 'First page',
    invalid: 'Check the permission, scope, reason and expiry.',
    holder: 'Holder identifier',
    window: 'Membership window',
    never: 'No expiry',
    role: 'Role',
    choosePermission: 'Choose a permission',
    // FR-029b: صلاحية المراجعة والاعتماد بلا قراءة النشاط كله مالهاش أثر، فالشاشة بتحذّر من كودين.
    commissionBusinessWideOnly:
      'This permission only takes effect together with business-wide read of commissions.',
    active: 'Active',
    expired: 'Expired',
  },
  invitations: invitationsEn,
  staffLogin: staffLoginEn,
  inApp: inAppEn,
  errors: {
    ...commissionPlanErrorsEn,
    ...commissionStatementExportErrorsEn,
    ATTENDANCE_MANUAL_INVALID_TIMES:
      'Manual attendance times must end after they start, not be in the future, last at most 16 hours, and not overlap another session.',
    ATTENDANCE_MANUAL_NOT_ELIGIBLE:
      'The employee is not attached to this branch on that date or the date is outside their contract.',
    ATTENDANCE_MANUAL_TIMEZONE_CHANGED:
      'The branch time zone changed after this request was filed. Reject it and file the day again.',
    ATTENDANCE_CORRECTION_MANUAL_SESSION:
      'A manual session cannot be corrected; request a void and a new session.',
    ...attendanceChangeEn.errors,
    ATTENDANCE_DEVICE_LOCKED:
      'This phone is registered to another employee. Clock in from your own phone or with the card at reception.',
    ATTENDANCE_DEVICE_NOT_ENROLLED:
      'Your passkey is registered on another phone. Clock in from that phone or with the card at reception. If you changed phones, ask your manager to unbind it.',
    PASSKEY_DEVICE_TAKEN:
      'This phone is registered to another employee, so your passkey cannot be enrolled on it. Enrol from your own phone; until then, use the card at reception.',
    PASSKEY_OTHER_DEVICE:
      'You already have a passkey on another phone. Enrol from that phone, or ask your manager to unbind it if you changed phones.',
    ...employeeIbanErrorsEn,
    DOCUMENT_TYPE_UNAVAILABLE: 'This document type does not exist or is inactive.',
    DOCUMENT_EXPIRY_REQUIRED: 'This document type needs an expiry date.',
    DOCUMENT_FILE_TYPE_INVALID: 'Employee documents must be PDF, JPEG or PNG.',
    DOCUMENT_FILE_ALREADY_RECORDED: 'This file is already recorded as a document.',
    DOCUMENT_TYPE_REVISION_CONFLICT: 'The document type changed. Reload it before saving again.',
    DOCUMENT_TYPE_LIMIT_REACHED: 'The company has reached the maximum of 100 document types.',
    LEAVE_PERIOD_INVALID: 'Leave dates or times are invalid.',
    LEAVE_TIME_STEP_INVALID:
      'Leave start and end times must use 15-minute steps in branch local time.',
    LEAVE_SPAN_TOO_LONG: 'Full-day leave cannot exceed 90 days, including the start and end dates.',
    LEAVE_NOTE_REQUIRED: 'Provide a note of 1–500 characters; Other requires a note.',
    LEAVE_LOCAL_TIME_INVALID:
      'The local time does not identify a unique instant in this branch timezone.',
    LEAVE_EMPLOYEE_INELIGIBLE: 'The employee is not eligible in this branch for the whole period.',
    LEAVE_OVERLAP: 'This request overlaps pending or approved leave.',
    LEAVE_PAST_OWN_FORBIDDEN:
      'Own leave requests cannot start before today in the branch timezone.',
    LEAVE_NOT_PENDING: 'Only pending leave can be decided or cancelled.',
    ...leaveErrorsEn,
    ...attendanceExceptionErrorsEn,
    ...attendanceCorrectionErrorsEn,
    LEAVE_REVISION_CONFLICT: 'The leave request changed. Reload and try again.',
    SCHEDULE_WEEK_INVALID: 'The schedule week must start on Saturday.',
    SCHEDULE_SHIFT_INVALID: 'Use valid shift times, with each shift at most 16 hours',
    SCHEDULE_DAY_LIMIT_EXCEEDED: 'The number of shifts exceeds the business daily limit',
    EMPLOYEE_BRANCH_NOT_LINKED: 'The employee is not linked to this branch today.',
    SCHEDULE_BREAK_INVALID: 'The break must be inside the shift',
    SCHEDULE_SHIFT_OVERLAP: 'The employee has overlapping shifts.',
    SCHEDULE_LOCAL_TIME_INVALID: 'This local time has no unique occurrence in the branch timezone.',
    SCHEDULE_EMPLOYEE_INELIGIBLE: 'The employee is not eligible at this branch on a scheduled day.',
    SCHEDULE_PAST_REASON_REQUIRED: 'A reason is required to edit a past day.',
    SCHEDULE_REVISION_CONFLICT: 'The schedule or template changed. Reload before saving.',
    SCHEDULE_APPLY_CONFLICT: 'Schedules already exist for some selected employees and weeks.',
    SCHEDULE_APPLY_BATCH_TOO_LARGE: 'Select at most 20 employee-week copies per application.',
    SCHEDULE_REPLACE_REASON_REQUIRED: 'A reason is required to replace existing schedules.',
    SCHEDULE_TEMPLATE_ARCHIVED: 'An archived template cannot be edited or applied.',
    EMPLOYEE_REVISION_CONFLICT:
      'Another manager changed this employee. Reload the latest record before saving.',
    EMPLOYEE_PRIMARY_BRANCH_REQUIRED: 'Include the primary branch in the working branches.',
    EMPLOYEE_BRANCH_DATE_BEFORE_START: 'A branch attachment must end after it starts.',
    EMPLOYEE_BRANCH_HISTORY_OVERLAP: 'This branch attachment overlaps existing history.',
    EMPLOYEE_BRANCH_HISTORY_IMMUTABLE: 'Closed branch attachment history cannot be changed.',
    STORAGE_NOT_CONFIGURED: 'Private file storage is not configured',
    STORAGE_UNAVAILABLE: 'Private file storage is temporarily unavailable',
    FILE_NOT_FOUND: 'File not found',
    FILE_NOT_READY: 'The file has not passed verification',
    FILE_TYPE_INVALID: 'The detected file type does not match an allowed upload type',
    FILE_SIZE_INVALID: 'The file size does not match the upload or exceeds its limit',
    FILE_CONTENT_INVALID: 'The file content could not be verified',
    EMPLOYEE_BUSINESS_NOT_FOUND: 'The employee business was not found.',
    EMPLOYEE_BRANCH_NOT_FOUND: 'The primary branch was not found.',
    EMPLOYEE_USER_LINK_UNAVAILABLE: 'The existing user could not be linked.',
    EMPLOYEE_CONTRACT_END_BEFORE_HIRE: 'The contract end must be on or after the hire date.',
    EMPLOYEE_USER_ALREADY_LINKED:
      'This user already has an active employee record in this business.',
    STAFF_ACCESS_PHONE_TAKEN:
      'This phone number belongs to another account. Check the number or ask the employee.',
    STAFF_ACCESS_ALREADY_GRANTED: 'This employee already has active access.',
    STAFF_ACCESS_NOT_ALLOWED:
      'You are not allowed to grant or cancel access for this employee on her primary branch.',
    ...employeeNumberErrorsEn,
    EMPLOYEE_CARD_CODE_UNAVAILABLE: "This card code can't be used. Choose another code.",
    ...employeeImportErrorsEn,
    IMPORT_BUSINESS_COUNTRY_REQUIRED:
      'Set the business country in settings before importing customers.',
    ...catalogServiceErrorsEn,
    ALERT_RULE_INVALID:
      'A value is outside what this alert kind allows (minutes, roles or channels).',
    ...packageTypeErrorsEn,
    ...discountApprovalErrorsEn,
    ...staffErrorsEn,
    PERMISSION_NOT_HELD: 'You do not currently hold this permission over the target scope',
    PERMISSION_SELF_EDIT: 'You cannot edit permissions on your own membership',
    PERMISSION_OWNER_PROTECTED: 'Owner permissions are protected from this change',
    PERMISSION_SCOPE_OUTSIDE_REACH: 'The target scope is outside your permission’s reach',
    PERMISSION_OWNER_ONLY: 'Only the company owner can grant this permission',
    PERMISSION_ROLE_FORBIDDEN: 'This system role cannot receive this permission',
    PERMISSION_ROLE_NOT_ELIGIBLE:
      'The ratings-read permission can only be granted to management roles (owner, general manager, business manager, branch manager)',
    PERMISSION_OVERRIDE_ENDED: 'This override has already ended',
    ...invitationErrorsEn,
    ALERT_RULE_REVISION_CONFLICT: 'Another manager changed this alert rule. Reload before saving.',
    TRANSACTION_RETRY_REQUIRED:
      'The change conflicted with another transaction and was not saved. Please retry.',
    INVALID_CUSTOMER_PHONE:
      'Choose a valid country calling code and enter national digits; Kuwait requires eight digits',
    OTP_UNAVAILABLE:
      'WhatsApp sign-in is unavailable. Ask your manager for help using your own cashier PIN.',
    PASSKEY_ALREADY_BOUND: 'A passkey is already bound. Ask your manager to unbind it first.',
    PASSKEY_INVALID: 'The passkey could not be verified.',
    PASSKEY_SELF_UNBIND: 'You cannot unbind your own passkey. Ask another permitted manager.',
    PASSKEY_REVISION_CONFLICT:
      'The passkey binding changed. Refresh its status before trying again.',
    PUSH_KEY_STALE: 'The notification key changed. Turn notifications on again.',
    PUSH_REGISTRATION_BUSY: 'Another registration for this device is in progress. Try again.',
    OTP_INVALID: 'The sign-in code is not valid.',
    VALIDATION_FAILED: 'The request is not valid',
    BAD_REQUEST: 'The request is malformed',
    UNAUTHENTICATED: 'Authentication is required',
    AUTHENTICATION_FAILED: 'Authentication failed',
    FORBIDDEN: 'This action is not allowed',
    FEATURE_DISABLED: 'This feature is not enabled for your company',
    PAIRING_CODE_INVALID: 'The pairing code is invalid or has expired',
    DEVICE_PENDING: 'The device is waiting for a manager to approve it',
    DEVICE_NOT_PENDING: 'No device in this branch is waiting for approval with this id',
    PIN_INVALID: 'The PIN is incorrect',
    PIN_LOCKED: 'The PIN is locked after too many wrong attempts — try again in 15 minutes',
    RATE_LIMITED: 'Too many attempts, try again later.',
    NOT_FOUND: 'Not found',
    METHOD_NOT_ALLOWED: 'Method not allowed',
    PAYLOAD_TOO_LARGE: 'Payload too large',
    URI_TOO_LONG: 'URI too long',
    UNSUPPORTED_MEDIA_TYPE: 'Unsupported media type',
    TOO_MANY_REQUESTS: 'Too many requests — try again shortly',
    ...idempotencyErrorsEn,
    NOT_READY: 'The service is not ready',
    RATING_LINK_UNAVAILABLE: 'This link is not available.',
    RATING_INPUT_INVALID: 'The rating is not valid. Check the stars and the note.',
    RATING_RANGE_TOO_WIDE:
      'The rating averages period must have a start and end within at most 366 days.',
    SESSION_RECOVERY_UNAVAILABLE: 'Saving is temporarily unavailable. Retry the same attempt.',
    INTERNAL_ERROR: 'An unexpected error occurred',
  },
  staff: {
    ...staffDuplicateNameEn,
    ...staffAccessAdminEn,
    ...employeeNumberAdminEn,
    listTitle: 'Employees',
    listLead: 'Manage employee records and working branches.',
    empty: 'No employees on this page.',
    edit: 'Edit',
    editTitle: 'Edit employee',
    save: 'Save changes',
    saved: 'Employee updated.',
    branches: 'Working branches',
    effectiveDate: 'Branch change date (Gregorian)',
    historyHint:
      'This date starts new attachments and ends removed attachments. Existing history is kept.',
    reload: 'Reload employee',
    cancel: 'Back to employees',
    next: 'Next page',
    first: 'First page',
    name: 'Name',
    employeeNumber: 'Employee number',
    search: 'Search by name or number',
    title: 'Create employee',
    nameEn: 'English name',
    nameAr: 'Arabic name (optional)',
    primaryBranch: 'Primary branch',
    role: 'Role',
    hireDate: 'Hire date',
    contractEnd: 'Contract end (optional)',
    userId: 'Existing user ID (optional)',
    create: 'Create employee',
    created: 'Employee saved:',
    invalid: 'Check the employee details, dates and user ID.',
    sectionIdentity: 'Employee details',
    sectionEmployment: 'Employment',
  },
  catalogServices: catalogServicesEn,
  catalogServiceImport: serviceImportEn,
  customerImport: customerImportEn,
  catalogServiceCategories: catalogServiceCategoriesEn,
  catalogServiceCategoryBranches: catalogServiceCategoryBranchesEn,
  catalogPackageTypes: catalogPackageTypesEn,
  packageExtension: catalogPackageExtensionEn,
  packageRefund: catalogPackageRefundEn,
  admin: adminEn,
  devices: devicesEn,
  pos: posEn,
  ...staffScreensEn,
  businessIdentity: businessIdentityEn,
} as const;
