import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';

import { CustomersController } from './http/customers.controller.ts';
import { createCustomerTransactions } from './persistence/drizzle-customer-transactions.ts';
import { FindOrCreateCustomerUseCase } from './use-cases/find-or-create-customer/find-or-create-customer.usecase.ts';

export const customersControllers = [CustomersController];

export function customersProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
): Provider[] {
  return [
    {
      provide: FindOrCreateCustomerUseCase,
      useValue:
        database === undefined
          ? null
          : new FindOrCreateCustomerUseCase(createCustomerTransactions(database, ids), ids, {
              now: () => new Date(),
            }),
    },
  ];
}
