import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';

import { systemClock } from '../../shared/adapters/system-clock.ts';
import { ServicesController } from './http/services.controller.ts';
import { createServiceTransactions } from './persistence/drizzle-service-transactions.ts';
import { CreateServiceUseCase } from './use-cases/create-service/create-service.usecase.ts';
import { UpdateServiceUseCase } from './use-cases/update-service/update-service.usecase.ts';

export const catalogControllers = [ServicesController];

export function catalogProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
): Provider[] {
  const transactions = database === undefined ? null : createServiceTransactions(database, ids);
  return [
    {
      provide: CreateServiceUseCase,
      useValue:
        transactions === null ? null : new CreateServiceUseCase(transactions, ids, systemClock),
    },
    {
      provide: UpdateServiceUseCase,
      useValue: transactions === null ? null : new UpdateServiceUseCase(transactions, systemClock),
    },
  ];
}
