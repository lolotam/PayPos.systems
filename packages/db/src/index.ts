export {
  OWNER_ROLE_ID,
  PERMISSIONS,
  PLATFORM_ROLES,
  SYSTEM_ROLES,
  type Permission,
  type PlatformPermission,
  type TenantPermission,
  type SystemRole,
} from './access-catalog.ts';
export {
  createAuthDatabase,
  type AuthDatabase,
  type IdentitySchema,
  type PlatformAuditEntry,
} from './auth-database.ts';
export { appendAuditLog, appendAuditLogs, type AuditEntry } from './audit-log.ts';
export {
  attendanceMonthlyInputsStatement,
  type AttendanceReportScope,
} from './attendance-monthly-inputs.ts';
export { leaveHistorySql } from './leave-history/leave-history-builder.sql.ts';
export {
  historyEmployeeVisible,
  historyIds,
  type HistoryScope,
} from './leave-history/leave-history-days.sql.ts';
export { historyLeaveSource, historyRows } from './leave-history/leave-history-rows.sql.ts';
export { historyLastTaken } from './leave-history/leave-history-last.sql.ts';
export { leaveListRecord, uuidArray } from './leave-history/leave-list-record.sql.ts';
export type {
  LeaveHistoryBuilderQuery,
  LeaveHistoryContext,
  LeaveHistoryCursor,
  LeaveHistoryReportOptions,
} from './leave-history/types.ts';
export { attendanceReportContractsStatement } from './attendance-report-contracts.ts';
export {
  attendanceStatementScheduledEmployeesStatement,
  type AttendanceStatementBranch,
} from './attendance-statement-scheduled-employees.ts';
export { businessIdentityReadStatement, readBusinessIdentity } from './business-identity-read.ts';
export { canonicalJson } from './canonical-json.ts';
export { createDatabase, type Database, type DatabaseOptions } from './client.ts';
export { markEventConsumed } from './consumed-events.ts';
export {
  currentSessionTipsStatement,
  listCurrentSessionTips,
  type CurrentSessionTipEntry,
  type CurrentSessionTips,
  type CurrentSessionTipsCursor,
  type CurrentSessionTipsPage,
  type CurrentSessionTipsPageRequest,
  type CurrentSessionTipsRange,
} from './current-session-tips.ts';
export { branchToday, currentAttachment, type BranchDay } from './employee-branch-links.ts';
export {
  assignEmployeeNumber,
  EmployeeNumberExhaustedError,
  lockEmployeeNumberCounter,
} from './employee-number-allocator.ts';
export { lockBusinessLogoReference } from './business-logo-reference.ts';
export { employeeDefaultShiftsStatement } from './employee-default-shifts-projection.ts';
export {
  createOutboxDispatcherDatabase,
  type ClaimedEvent,
  type DeliveryOutcome,
  type DispatchOptions,
  type OutboxDispatcherDatabase,
} from './dispatcher.ts';
export {
  IdempotencyKeyBusyError,
  IdempotencyKeyReusedError,
  runIdempotent,
  type IdempotencyRequest,
  type IdempotentResult,
  type StoredResponse,
} from './idempotency.ts';
export { appendOutboxEvent, appendOutboxEvents, type OutboxEvent } from './outbox.ts';
export {
  assertStatementPeriodsOpen,
  lockStatementPeriods,
  reopenReviewedStatementPeriods,
  StatementPeriodClosedError,
  StatementPeriodFormatError,
  type LockedStatementPeriod,
  type LockStatementPeriodsInput,
  type ReopenReviewedStatementPeriodsInput,
  type StatementStatus,
} from './statement-periods.ts';
export type { IdGenerator, TenantOptions, TenantWrappers, Tx } from './with-tenant.ts';
export { OWNER_DERIVED_PERMISSIONS, OWNER_GRANTED_PERMISSIONS } from './role-defaults.ts';
export { FEATURE_FLAGS, PROVISIONAL_PLAN_ID, type FeatureFlag } from './seed.ts';
export {
  canonicalOwnerSql,
  systemRolePolicy,
  systemRoleOverrideAllowedSql,
  systemRoleGrantAllowedSql,
} from './system-role-policy.ts';
export { verticalTemplate, type VerticalTemplate } from './vertical-templates.ts';
export {
  grantPlatformPermission,
  revokePlatformPermission,
  type PlatformGrantOutcome,
  type PlatformGrantRequest,
} from './platform-grants.ts';
export {
  createPlatformWhatsappDatabase,
  type PlatformWhatsappDatabase,
} from './platform-whatsapp-database.ts';
export { createStaffOtpDatabase, type StaffOtpDatabase } from './staff-otp-database.ts';
export {
  checkStaffPrivateView,
  closeStaffPrivateView,
  deleteStaffPrivateViewRows,
  openStaffPrivateView,
  staffPrivateViewIdentifier,
  staffPrivateViewSequenceIdentifier,
  type StaffPrivateViewCheckOutcome,
  type StaffPrivateViewCheckRequest,
  type StaffPrivateViewCloseRequest,
  type StaffPrivateViewDecisionRow,
  type StaffPrivateViewOpenDecision,
  type StaffPrivateViewOpenOutcome,
  type StaffPrivateViewOpenRequest,
  type StaffPrivateViewSessionRow,
} from './staff-private-view.ts';
export type {
  OtpChallengeRecord,
  OtpAttemptRecord,
  OtpExecutionResult,
} from './staff-otp-types.ts';
export { assertReplayBounds, ReplayCursorError } from './replay-cursor.ts';
