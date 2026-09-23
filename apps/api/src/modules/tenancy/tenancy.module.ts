import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';

import { BranchesController } from './http/branches.controller.ts';
import { BusinessesController } from './http/businesses.controller.ts';
import { createTenancyTransactions } from './persistence/tenancy-transactions.ts';
import { jsonVerticalTemplates } from './persistence/vertical-templates.ts';
import { CreateBranch } from './use-cases/create-branch/create-branch.ts';
import { CreateBusiness } from './use-cases/create-business/create-business.ts';

/** The controllers tenancy mounts. */
export const tenancyControllers = [BusinessesController, BranchesController];

/**
 * The tenancy wiring — the one place its ports are bound to their adapters. Without a database the use cases are
 * absent and the routes answer NOT_READY after the guards.
 *
 * @param database the tenant wrappers, when the app has a database
 * @param ids      the UUID v7 generator
 * @returns the providers to add to the root module
 */
export function tenancyProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
): Provider[] {
  const transactions = database === undefined ? null : createTenancyTransactions(database, ids);
  return [
    {
      provide: CreateBusiness,
      useValue:
        transactions === null ? null : new CreateBusiness(transactions, jsonVerticalTemplates, ids),
    },
    {
      provide: CreateBranch,
      useValue: transactions === null ? null : new CreateBranch(transactions, ids),
    },
  ];
}
