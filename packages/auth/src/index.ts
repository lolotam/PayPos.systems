export {
  AUTH_BASE_PATH,
  createAuth,
  type AuthLogEntry,
  type AuthOptions,
  type AuthService,
  type VerifiedSession,
} from './config.ts';
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
export { readStaffOtpConfiguration, type OtpConfiguration } from './staff-otp/configuration.ts';
export type {
  OtpCapability,
  OtpRates,
  OtpSender,
  OtpStrategies,
  StaffDeviceContext,
  StaffEligibility,
  StaffSession,
} from './staff-otp/types.ts';
export type { StaffSessions } from './staff-sessions.ts';
export { approvePhoneBinding } from './approve-phone-binding.ts';
