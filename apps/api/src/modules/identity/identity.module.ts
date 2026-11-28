import { PersonalOtpController } from './http/personal-otp.controller.ts';
import { PasswordResetOtpController } from './http/password-reset-otp.controller.ts';
import { StaffPinResetController } from './http/staff-pin-reset.controller.ts';
import type { Provider } from '@nestjs/common';
import { REQUEST_AUTHORIZER } from '../../shared/request-authorizer.ts';
import { APP_GUARD } from '@nestjs/core';
import { BusinessPermissionsController } from './http/business-permissions.controller.ts';
import { PermissionsController } from './http/permissions.controller.ts';
import { SetDiscountLimit } from './use-cases/set-discount-limit/set-discount-limit.ts';
import { createDiscountLimitTransactions } from './persistence/discount-limit-transactions.ts';
import { createPermissionOverrideTransactions } from './persistence/permission-override-transactions.ts';
import { createGrantInvalidator } from './persistence/grant-invalidator.ts';
import { GrantPermissionOverride } from './use-cases/grant-permission-override/grant-permission-override.ts';
import { RevokePermissionOverride } from './use-cases/revoke-permission-override/revoke-permission-override.ts';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import type { Redis } from 'ioredis';

import { systemClock } from '../../shared/adapters/system-clock.ts';
import type { Clock } from '../../shared/ports/clock.port.ts';
import type { OnboardingEmailSealer } from '../../shared/ports/onboarding-email.port.ts';
import { DEVICE_AUTHENTICATOR } from '../../shared/device-authenticator.ts';
import { STAFF_AUTHENTICATION } from '../../shared/staff-authentication.ts';
import {
  StaffOtpController,
  STAFF_OTP_API,
  STAFF_SESSIONS,
  STAFF_POS_ORIGIN,
} from './http/staff-otp.controller.ts';
import { createStaffEligibility } from './persistence/staff-eligibility.ts';
import type { AuthService, StaffOtpApi, StaffSessions } from '@pospay/auth';
import { redisOtpRates } from './persistence/redis-otp-rates.ts';
import { createOtpSender } from './persistence/bullmq-otp-sender.ts';

import { AccessGuard, FeatureGuard } from './http/access.guard.ts';
import {
  CASHIER_PIN_USE_CASES,
  CashierPinsController,
  type CashierPinUseCases,
} from './http/cashier-pins.controller.ts';
import { CompaniesController } from './http/companies.controller.ts';
import { PendingDevicesController } from './http/pending-devices.controller.ts';
import {
  MeController,
  MY_PREFERENCES,
  STAFF_ACCESS_CAPABILITY,
  WORKSPACE_NAMES,
} from './http/me.controller.ts';
import { SetMyPreferences } from './use-cases/set-my-preferences/set-my-preferences.ts';
import {
  DEVICE_USE_CASES,
  DevicesController,
  type DeviceUseCases,
} from './http/devices.controller.ts';
import { createAccessReader } from './persistence/access-reader.ts';
import { authPinHasher } from './persistence/auth-pin-hasher.ts';
import { createCashierPinTransactions } from './persistence/cashier-pin-transactions.ts';
import { authDeviceSecrets } from './persistence/device-secrets.ts';
import { createDeviceTransactions } from './persistence/device-transactions.ts';
import { createRedisPairingCodes } from './persistence/redis-pairing-codes.ts';
import { createRedisPinAttempts } from './persistence/redis-pin-attempts.ts';
import { createOnboardingTransactions } from './persistence/onboarding-transactions.ts';
import { tenancyCompanyRegistry } from './persistence/tenancy-company-registry.adapter.ts';
import { createWorkspaceNames } from './persistence/workspace-names.adapter.ts';
import { AuthorizeRequest } from './use-cases/authorize-request/authorize-request.ts';
import { CheckFeature } from './use-cases/check-feature/check-feature.ts';
import { OnboardCompany } from './use-cases/onboard-company/onboard-company.ts';
import { ApproveDevice } from './use-cases/approve-device/approve-device.ts';
import { AuthenticateDevice } from './use-cases/authenticate-device/authenticate-device.ts';
import { ClaimDeviceToken } from './use-cases/claim-device-token/claim-device-token.ts';
import { IssuePairingCode } from './use-cases/issue-pairing-code/issue-pairing-code.ts';
import { RegisterDevice } from './use-cases/register-device/register-device.ts';
import { RevokeDevice } from './use-cases/revoke-device/revoke-device.ts';
import { SetCashierPin } from './use-cases/set-cashier-pin/set-cashier-pin.ts';
import { VerifyCashierPin } from './use-cases/verify-cashier-pin/verify-cashier-pin.ts';
import { StaffPinController } from './http/staff-pin.controller.ts';
import { MemberInvitationsController } from './http/member-invitations.controller.ts';
import { MembershipsController } from './http/memberships.controller.ts';
import { memberInvitationProviders } from './member-invitations.wiring.ts';
import { PrivateViewController } from './http/private-view.controller.ts';
import {
  staffPinAndPrivateViewProviders,
  VERIFY_DISCOUNT_APPROVER_PIN,
} from './staff-pin.wiring.ts';
import { AUTH_SERVICE } from '../../shared/session.guard.ts';
import { DISCOUNT_APPROVER_VERIFIER } from '../../shared/discount-approver-pin.ts';

export { VERIFY_DISCOUNT_APPROVER_PIN };

/** The controllers identity mounts. */
export const identityControllers = [
  PermissionsController,
  BusinessPermissionsController,
  CompaniesController,
  DevicesController,
  PendingDevicesController,
  CashierPinsController,
  MeController,
  StaffOtpController,
  PersonalOtpController,
  PasswordResetOtpController,
  StaffPinResetController,
  StaffPinController,
  PrivateViewController,
  MemberInvitationsController,
  MembershipsController,
];

/** الربط العام يمر من composition root؛ تفاصيل القراءة والنقل تظل داخل الهوية. */
export function staffOtpDependencies(options: {
  database: TenantWrappers;
  redis: Redis;
  ids: IdGenerator;
  hashKey: string;
  redisUrl: string;
}) {
  const { database, redis, ids, hashKey, redisUrl } = options;
  return {
    eligibility: createStaffEligibility(database),
    rates: redisOtpRates(redis, hashKey, ids),
    transport: createOtpSender(redisUrl),
  };
}

/**
 * The identity wiring — the one place its port is bound to the Postgres adapter. The two guards are registered
 * after the session guard, in this order: access (@Require), then feature (@RequiresFeature). Without a database
 * both use cases are absent and every @Require route is refused.
 *
 * @param database the tenant wrappers, when the app has a database
 * @param ids      the UUID v7 generator
 * @param redis    the API's Redis client, for pairing codes and PIN attempts (devices and PINs need it)
 * @param staffAccessRoutes whether the spec 076 staff-access slice is open; the workspace read tells the admin
 * @param staffPinClock the clock the staff PIN flow measures the temporary PIN and its proof against
 * @returns the providers to add to the root module, after the session guard
 */
export function identityProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  redis?: Redis,
  staff?: {
    api: StaffOtpApi | null;
    sessions: StaffSessions | null;
    origin: string | null;
    nativeOrigins?: readonly string[];
  },
  staffCompanyOf: (userId: string) => Promise<string | null> = unavailableStaffCompany,
  /** أصل لوحة الإدارة اللي رابط تعيين كلمة المرور بيتبني عليه، وساعة عمر الرابط. */
  invitations?: { readonly adminOrigin: string; readonly clock?: { now(): Date } },
  staffAccessRoutes = false,
  staffPinClock: Clock = systemClock,
  /** ختم إيميلات الترحيب: من غيره مفيش بريد دعوة. */
  onboardingSealer?: OnboardingEmailSealer,
): Provider[] {
  const sessions = staff?.sessions ?? null;
  return [
    ...permissionProviders(database, ids, redis),
    ...memberInvitationProviders(
      database,
      ids,
      redis,
      invitations?.adminOrigin,
      invitations?.clock ?? systemClock,
      onboardingSealer,
    ),
    {
      provide: STAFF_AUTHENTICATION,
      useValue: database === undefined ? null : createStaffEligibility(database),
    },
    { provide: STAFF_OTP_API, useValue: staff?.api ?? null },
    { provide: STAFF_SESSIONS, useValue: staff?.sessions ?? null },
    {
      provide: STAFF_POS_ORIGIN,
      useValue: staff?.origin ? { pos: staff.origin, native: staff.nativeOrigins ?? [] } : null,
    },
    ...staffPinAndPrivateViewProviders({
      database,
      ids,
      redis,
      sessions,
      staffAccessRoutes,
      clock: staffPinClock,
    }),
    { provide: DISCOUNT_APPROVER_VERIFIER, useExisting: VERIFY_DISCOUNT_APPROVER_PIN },
    ...coreIdentityProviders(database, ids, redis, staffCompanyOf, staffAccessRoutes),
  ];
}

function coreIdentityProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  redis: Redis | undefined,
  staffCompanyOf: (userId: string) => Promise<string | null>,
  staffAccessRoutes: boolean,
): Provider[] {
  const capabilities = identityCapabilities(database, ids, redis, staffCompanyOf);
  const reader = capabilities.reader;
  return [
    ...meProviders(capabilities.names, staffAccessRoutes),
    { provide: OnboardCompany, useValue: capabilities.onboard },
    { provide: DEVICE_USE_CASES, useValue: capabilities.devices?.useCases ?? null },
    { provide: DEVICE_AUTHENTICATOR, useValue: capabilities.devices?.authenticator ?? null },
    {
      provide: CASHIER_PIN_USE_CASES,
      useValue: database === undefined ? null : cashierPinUseCases(database, ids, redis),
    },
    { provide: AuthorizeRequest, useValue: reader === null ? null : new AuthorizeRequest(reader) },
    { provide: REQUEST_AUTHORIZER, useExisting: AuthorizeRequest },
    { provide: CheckFeature, useValue: reader === null ? null : new CheckFeature(reader) },
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_GUARD, useClass: FeatureGuard },
  ];
}

// القراءات والحالات الاختيارية اللي محتاجة داتابيز؛ ناقصها بيرجّع null فيتوفر المسار بـ 503.
function identityCapabilities(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  redis: Redis | undefined,
  staffCompanyOf: (userId: string) => Promise<string | null>,
) {
  return {
    reader: database === undefined ? null : createAccessReader(database),
    names: database === undefined ? null : createWorkspaceNames(),
    onboard:
      database === undefined
        ? null
        : new OnboardCompany(
            createOnboardingTransactions(database, ids, staffCompanyOf),
            tenancyCompanyRegistry,
            ids,
          ),
    devices: database === undefined ? null : deviceUseCases(database, ids, redis),
  };
}

// ما يحتاجه MeController: أسماء مساحات العمل، وقدرة 076، وتفضيل الحساب اللي كله من واجهة الاعتماد نفسها بلا قاعدة بيانات ولا صلاحيات شركة.
function meProviders(
  names: ReturnType<typeof createWorkspaceNames> | null,
  staffAccessRoutes: boolean,
): Provider[] {
  return [
    { provide: WORKSPACE_NAMES, useValue: names },
    { provide: STAFF_ACCESS_CAPABILITY, useValue: staffAccessRoutes },
    {
      provide: MY_PREFERENCES,
      useFactory: (auth: AuthService | null) => auth?.preferences ?? null,
      inject: [AUTH_SERVICE],
    },
    {
      provide: SetMyPreferences,
      useFactory: (auth: AuthService | null) =>
        auth === null ? null : new SetMyPreferences(auth.preferences),
      inject: [AUTH_SERVICE],
    },
  ];
}

// يبقى ربط الصلاحيات هنا مع فصل المجموعة حتى لا تتضخم دالة تركيب الهوية.
function permissionProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  redis: Redis | undefined,
): Provider[] {
  return [
    {
      provide: SetDiscountLimit,
      useValue:
        database === undefined
          ? null
          : new SetDiscountLimit(
              createDiscountLimitTransactions(database, ids),
              createGrantInvalidator(redis),
            ),
    },
    {
      provide: GrantPermissionOverride,
      useValue:
        database === undefined
          ? null
          : new GrantPermissionOverride(
              createPermissionOverrideTransactions(database, ids),
              createGrantInvalidator(redis),
            ),
    },
    {
      provide: RevokePermissionOverride,
      useValue:
        database === undefined
          ? null
          : new RevokePermissionOverride(
              createPermissionOverrideTransactions(database, ids),
              createGrantInvalidator(redis),
            ),
    },
  ];
}

function deviceUseCases(database: TenantWrappers, ids: IdGenerator, redis: Redis | undefined) {
  const transactions = createDeviceTransactions(database, ids);
  const authenticate = new AuthenticateDevice(transactions, authDeviceSecrets, systemClock);
  const authenticator = { authenticate: (token: string) => authenticate.execute(token) };
  if (redis === undefined) return { useCases: null, authenticator };
  const codes = createRedisPairingCodes(redis, systemClock);
  const useCases: DeviceUseCases = {
    issuePairingCode: new IssuePairingCode(codes, transactions),
    registerDevice: new RegisterDevice(codes, transactions, authDeviceSecrets, ids),
    approveDevice: new ApproveDevice(transactions, systemClock),
    claimDeviceToken: new ClaimDeviceToken(transactions, authDeviceSecrets, systemClock),
    revokeDevice: new RevokeDevice(transactions, systemClock),
  };
  return { useCases, authenticator };
}

function cashierPinUseCases(
  database: TenantWrappers,
  ids: IdGenerator,
  redis: Redis | undefined,
): CashierPinUseCases | null {
  if (redis === undefined) return null;
  const transactions = createCashierPinTransactions(database, ids);
  return {
    setCashierPin: new SetCashierPin(transactions, authPinHasher, systemClock),
    verifyCashierPin: new VerifyCashierPin(
      transactions,
      authPinHasher,
      createRedisPinAttempts(redis, ids),
    ),
  };
}

async function unavailableStaffCompany(): Promise<string | null> {
  throw new Error('AUTH_UNAVAILABLE');
}
