import { PersonalOtpController } from './http/personal-otp.controller.ts';
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
import { DEVICE_AUTHENTICATOR } from '../../shared/device-authenticator.ts';
import { STAFF_AUTHENTICATION } from '../../shared/staff-authentication.ts';
import {
  StaffOtpController,
  STAFF_OTP_API,
  STAFF_SESSIONS,
  STAFF_POS_ORIGIN,
} from './http/staff-otp.controller.ts';
import { createStaffEligibility } from './persistence/staff-eligibility.ts';
import type { StaffOtpApi, StaffSessions } from '@pospay/auth';
import { redisOtpRates } from './persistence/redis-otp-rates.ts';
import { createOtpSender } from './persistence/bullmq-otp-sender.ts';

import { AccessGuard, FeatureGuard } from './http/access.guard.ts';
import {
  CASHIER_PIN_USE_CASES,
  CashierPinsController,
  type CashierPinUseCases,
} from './http/cashier-pins.controller.ts';
import { CompaniesController } from './http/companies.controller.ts';
import { MeController, WORKSPACE_NAMES } from './http/me.controller.ts';
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
import type { WorkspaceNames } from './queries/my-workspaces.query.ts';
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
import {
  StaffPinController,
  STAFF_PIN_USE_CASES,
  type StaffPinUseCases,
} from './http/staff-pin.controller.ts';
import { createStaffPinTransactions } from './persistence/staff-pin-transactions.ts';
import { SignInStaffPin } from './use-cases/sign-in-staff-pin/sign-in-staff-pin.ts';
import { ResetStaffPin } from './use-cases/reset-staff-pin/reset-staff-pin.ts';

/** The controllers identity mounts. */
export const identityControllers = [
  PermissionsController,
  BusinessPermissionsController,
  CompaniesController,
  DevicesController,
  CashierPinsController,
  MeController,
  StaffOtpController,
  PersonalOtpController,
  StaffPinController,
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
 * @returns the providers to add to the root module, after the session guard
 */
export function identityProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  redis?: Redis,
  staff?: { api: StaffOtpApi | null; sessions: StaffSessions | null; origin: string | null },
): Provider[] {
  const reader = database === undefined ? null : createAccessReader(database);
  const names: WorkspaceNames | null = database === undefined ? null : createWorkspaceNames();
  const onboard =
    database === undefined
      ? null
      : new OnboardCompany(
          createOnboardingTransactions(database, ids),
          tenancyCompanyRegistry,
          ids,
        );
  const devices = database === undefined ? null : deviceUseCases(database, ids, redis);
  return [
    ...permissionProviders(database, ids, redis),
    {
      provide: STAFF_AUTHENTICATION,
      useValue: database === undefined ? null : createStaffEligibility(database),
    },
    { provide: STAFF_OTP_API, useValue: staff?.api ?? null },
    { provide: STAFF_SESSIONS, useValue: staff?.sessions ?? null },
    { provide: STAFF_POS_ORIGIN, useValue: staff?.origin ?? null },
    {
      provide: STAFF_PIN_USE_CASES,
      useValue:
        database === undefined
          ? null
          : staffPinUseCases(database, ids, redis, staff?.sessions ?? null),
    },
    { provide: WORKSPACE_NAMES, useValue: names },
    { provide: OnboardCompany, useValue: onboard },
    { provide: DEVICE_USE_CASES, useValue: devices?.useCases ?? null },
    { provide: DEVICE_AUTHENTICATOR, useValue: devices?.authenticator ?? null },
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

function staffPinUseCases(
  database: TenantWrappers,
  ids: IdGenerator,
  redis: Redis | undefined,
  sessions: StaffSessions | null,
): StaffPinUseCases | null {
  if (redis === undefined || sessions === null) return null;
  const db = createStaffPinTransactions(database, ids);
  const eligibility = createStaffEligibility(database);
  return {
    reset: new ResetStaffPin(db, authPinHasher, systemClock),
    signIn: new SignInStaffPin(db, authPinHasher, createRedisPinAttempts(redis, ids), {
      sessions,
      ...eligibility,
    }),
  };
}
