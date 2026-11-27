export {
  AUTH_BASE_PATH,
  createAuth,
  type AuthLogEntry,
  type AuthOptions,
  type AuthService,
  type VerifiedSession,
} from './config.ts';
export { AUTH_COOKIE_PREFIX_PATTERN, DEFAULT_AUTH_COOKIE_PREFIX } from './session-cookie.ts';
export {
  resolveUserPrincipal,
  type Grant,
  type MembershipScope,
  type Principal,
  type ResolvedPrincipal,
} from './principal.ts';
export {
  OperatorInputError,
  createPlatformUser,
  type CreatePlatformUserInput,
} from './create-platform-user.ts';
export {
  InvitationLinkRefusedError,
  MEMBER_INVITATION_LINK_TTL_MS,
  isStaffSyntheticEmail,
  type EmailState,
  type InvitedMemberOutcome,
  type MemberInvitationAccounts,
} from './member-invitations.ts';
export {
  formatDeviceToken,
  hashDeviceSecret,
  newDeviceSecret,
  parseDeviceToken,
  verifyDeviceSecret,
  type DeviceToken,
} from './device-credentials.ts';
export { hashCashierPin, verifyCashierPin } from './cashier-pin.ts';
export { createStaffOtpApi, type StaffOtpApi } from './staff-otp/api.ts';
export {
  createStaffOtpExecution,
  createStaffOtpMaintenance,
  type StaffOtpExecution,
} from './staff-otp/execution.ts';
export {
  createPasswordResetOtpApi,
  PASSWORD_RESET_LIFETIME_MS,
  PASSWORD_RESET_RETRY_MS,
  type PasswordResetOtpApi,
  type PasswordResetOtpApiOptions,
  type PasswordResetOutcome,
  type PasswordResetRequestResult,
} from './password-reset-otp/api.ts';
export {
  readEmailOtpConfiguration,
  type EmailOtpConfiguration,
} from './password-reset-otp/configuration.ts';
export { readStaffOtpConfiguration, type OtpConfiguration } from './staff-otp/configuration.ts';
export {
  createStaffPinResetApi,
  STAFF_PIN_RESET_LIFETIME_MS,
  STAFF_PIN_RESET_RETRY_MS,
  type StaffPinResetApi,
  type StaffPinResetApiOptions,
  type StaffPinResetChannel,
  type StaffPinResetRequestResult,
  type StaffPinResetResult,
  type StaffPinWriter,
  type StaffRecoveryReader,
} from './staff-pin-reset/api.ts';
export type {
  OtpCapability,
  OtpRates,
  OtpSender,
  OtpStrategies,
  EmailOtpStrategies,
  StaffDeviceContext,
  StaffEligibility,
  StaffSession,
} from './staff-otp/types.ts';
export type { StaffSessions } from './staff-sessions.ts';
export { StaffProofChanged } from './staff-sessions.ts';
export type { SignOutOutcome } from './session-sign-out.ts';
export {
  StaffSessionEnded,
  staffDeviceSessionLockKey,
  type StaffSessionProof,
} from './staff-session-fence.ts';
export { OTP_LIFETIME_MS, OTP_RETRY_MS, STAFF_LOGIN_CONCURRENCY } from './staff-otp/policy.ts';
export { approvePhoneBinding } from './approve-phone-binding.ts';
export {
  createStaffUserAccess,
  STAFF_SYNTHETIC_EMAIL_DOMAIN,
  staffSyntheticEmail,
  type StaffUserAccess,
  type StaffUserPhoneChangeRequest,
} from './staff-access-users.ts';

export type { PersonalWorkspace, PersonalSession } from './staff-otp/types.ts';
export type { PersonalSessions } from './personal-sessions.ts';
export { passkeyPolicy } from './passkey-policy.ts';
export type {
  PasskeyFacade,
  EnrollmentScope,
  AttendanceScope,
  AttendanceProof,
  ActivePasskeyBindings,
} from './passkeys.ts';
export type { StaffOtpApiOptions } from './staff-otp/api.ts';
export type {
  PrivateViewCheckResult,
  PrivateViewExpired,
  PrivateViewFacade,
  PrivateViewMismatch,
  PrivateViewOpened,
  PrivateViewOpenInput,
  PrivateViewOpenResult,
  PrivateViewPassed,
  PrivateViewPinInput,
  PrivateViewProof,
  PrivateViewRefused,
  PrivateViewScope,
} from './private-view.ts';
export { deriveEmployeeCardKey } from './employee-card-key.ts';
export { createMyPreferences, type MyPreferences } from './my-preferences.ts';
