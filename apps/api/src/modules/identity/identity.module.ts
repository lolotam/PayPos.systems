import type { Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import type { Redis } from 'ioredis';

import { systemClock } from '../../shared/adapters/system-clock.ts';
import { DEVICE_AUTHENTICATOR } from '../../shared/device-authenticator.ts';

import { AccessGuard, FeatureGuard } from './http/access.guard.ts';
import { CompaniesController } from './http/companies.controller.ts';
import {
  DEVICE_USE_CASES,
  DevicesController,
  type DeviceUseCases,
} from './http/devices.controller.ts';
import { createAccessReader } from './persistence/access-reader.ts';
import { authDeviceSecrets } from './persistence/device-secrets.ts';
import { createDeviceTransactions } from './persistence/device-transactions.ts';
import { createRedisPairingCodes } from './persistence/redis-pairing-codes.ts';
import { createOnboardingTransactions } from './persistence/onboarding-transactions.ts';
import { tenancyCompanyRegistry } from './persistence/tenancy-company-registry.adapter.ts';
import { AuthorizeRequest } from './use-cases/authorize-request/authorize-request.ts';
import { CheckFeature } from './use-cases/check-feature/check-feature.ts';
import { OnboardCompany } from './use-cases/onboard-company/onboard-company.ts';
import { ApproveDevice } from './use-cases/approve-device/approve-device.ts';
import { AuthenticateDevice } from './use-cases/authenticate-device/authenticate-device.ts';
import { ClaimDeviceToken } from './use-cases/claim-device-token/claim-device-token.ts';
import { IssuePairingCode } from './use-cases/issue-pairing-code/issue-pairing-code.ts';
import { RegisterDevice } from './use-cases/register-device/register-device.ts';
import { RevokeDevice } from './use-cases/revoke-device/revoke-device.ts';

/** The controllers identity mounts. */
export const identityControllers = [CompaniesController, DevicesController];

/**
 * The identity wiring — the one place its port is bound to the Postgres adapter. The two guards are registered
 * after the session guard, in this order: access (@Require), then feature (@RequiresFeature). Without a database
 * both use cases are absent and every @Require route is refused.
 *
 * @param database the tenant wrappers, when the app has a database
 * @param ids      the UUID v7 generator
 * @param redis    the API's Redis client, for pairing codes (devices need it)
 * @returns the providers to add to the root module, after the session guard
 */
export function identityProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  redis?: Redis,
): Provider[] {
  const reader = database === undefined ? null : createAccessReader(database);
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
    { provide: OnboardCompany, useValue: onboard },
    { provide: DEVICE_USE_CASES, useValue: devices?.useCases ?? null },
    { provide: DEVICE_AUTHENTICATOR, useValue: devices?.authenticator ?? null },
    { provide: AuthorizeRequest, useValue: reader === null ? null : new AuthorizeRequest(reader) },
    { provide: CheckFeature, useValue: reader === null ? null : new CheckFeature(reader) },
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_GUARD, useClass: FeatureGuard },
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
