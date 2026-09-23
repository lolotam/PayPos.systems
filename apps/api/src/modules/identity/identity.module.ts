import type { Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { IdGenerator, TenantWrappers } from '@pospay/db';

import { AccessGuard, FeatureGuard } from './http/access.guard.ts';
import { CompaniesController } from './http/companies.controller.ts';
import { createAccessReader } from './persistence/access-reader.ts';
import { createOnboardingTransactions } from './persistence/onboarding-transactions.ts';
import { tenancyCompanyRegistry } from './persistence/tenancy-company-registry.adapter.ts';
import { AuthorizeRequest } from './use-cases/authorize-request/authorize-request.ts';
import { CheckFeature } from './use-cases/check-feature/check-feature.ts';
import { OnboardCompany } from './use-cases/onboard-company/onboard-company.ts';

/** The controllers identity mounts. */
export const identityControllers = [CompaniesController];

/**
 * The identity wiring — the one place its port is bound to the Postgres adapter. The two guards are registered
 * after the session guard, in this order: access (@Require), then feature (@RequiresFeature). Without a database
 * both use cases are absent and every @Require route is refused.
 *
 * @param database the tenant wrappers, when the app has a database
 * @param ids      the UUID v7 generator
 * @returns the providers to add to the root module, after the session guard
 */
export function identityProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
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
  return [
    { provide: OnboardCompany, useValue: onboard },
    { provide: AuthorizeRequest, useValue: reader === null ? null : new AuthorizeRequest(reader) },
    { provide: CheckFeature, useValue: reader === null ? null : new CheckFeature(reader) },
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_GUARD, useClass: FeatureGuard },
  ];
}
