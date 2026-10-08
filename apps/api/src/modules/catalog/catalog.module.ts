import { PackageTypesController } from './http/package-types.controller.ts';
import { createPackageTypeTransactions } from './persistence/drizzle-package-type-transactions.ts';
import { CreatePackageTypeUseCase } from './use-cases/create-package-type/create-package-type.usecase.ts';
import { UpdatePackageTypeUseCase } from './use-cases/update-package-type/update-package-type.usecase.ts';
import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';

import { systemClock } from '../../shared/adapters/system-clock.ts';
import { ServicesController } from './http/services.controller.ts';
import { createServiceTransactions } from './persistence/drizzle-service-transactions.ts';
import { CreateServiceUseCase } from './use-cases/create-service/create-service.usecase.ts';
import { UpdateServiceUseCase } from './use-cases/update-service/update-service.usecase.ts';

export const catalogControllers = [ServicesController, PackageTypesController];

export function catalogProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
): Provider[] {
  const transactions = database === undefined ? null : createServiceTransactions(database, ids);
  const packages = database === undefined ? null : createPackageTypeTransactions(database, ids);
  return [
    {
      provide: CreatePackageTypeUseCase,
      useValue: packages === null ? null : new CreatePackageTypeUseCase(packages, ids, systemClock),
    },
    {
      provide: UpdatePackageTypeUseCase,
      useValue: packages === null ? null : new UpdatePackageTypeUseCase(packages, systemClock),
    },
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
