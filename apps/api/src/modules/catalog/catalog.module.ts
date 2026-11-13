import { PackageTypesController } from './http/package-types.controller.ts';
import { BranchServiceCategoriesController } from './http/branch-service-categories.controller.ts';
import { ServiceCategoriesController } from './http/service-categories.controller.ts';
import { createPackageTypeTransactions } from './persistence/drizzle-package-type-transactions.ts';
import { createServiceCategoryTransactions } from './persistence/drizzle-service-category-transactions.ts';
import { CreatePackageTypeUseCase } from './use-cases/create-package-type/create-package-type.usecase.ts';
import { UpdatePackageTypeUseCase } from './use-cases/update-package-type/update-package-type.usecase.ts';
import { CloseServiceCategoryUseCase } from './use-cases/close-service-category/close-service-category.usecase.ts';
import { CreateServiceCategoryUseCase } from './use-cases/create-service-category/create-service-category.usecase.ts';
import { RenameServiceCategoryUseCase } from './use-cases/rename-service-category/rename-service-category.usecase.ts';
import { ReopenServiceCategoryUseCase } from './use-cases/reopen-service-category/reopen-service-category.usecase.ts';
import { SetServiceCategoryBranchStateUseCase } from './use-cases/set-service-category-branch-state/set-service-category-branch-state.usecase.ts';
import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';

import { systemClock } from '../../shared/adapters/system-clock.ts';
import { ServicesController } from './http/services.controller.ts';
import { createServiceTransactions } from './persistence/drizzle-service-transactions.ts';
import { CloseServiceUseCase } from './use-cases/close-service/close-service.usecase.ts';
import { CreateServiceUseCase } from './use-cases/create-service/create-service.usecase.ts';
import { ReopenServiceUseCase } from './use-cases/reopen-service/reopen-service.usecase.ts';
import { UpdateServiceUseCase } from './use-cases/update-service/update-service.usecase.ts';

export const catalogControllers = [
  ServicesController,
  PackageTypesController,
  ServiceCategoriesController,
  BranchServiceCategoriesController,
];

type ServiceTx = ReturnType<typeof createServiceTransactions> | null;
type CategoryTx = ReturnType<typeof createServiceCategoryTransactions> | null;

/** مزوّدو قفل وفتح التصنيفات والخدمات، منفصلون عشان قائمة المزوّدين الرئيسية تفضل في حد الدالة. */
function closingProviders(transactions: ServiceTx, categories: CategoryTx): Provider[] {
  return [
    {
      provide: CloseServiceUseCase,
      useValue: transactions === null ? null : new CloseServiceUseCase(transactions, systemClock),
    },
    {
      provide: ReopenServiceUseCase,
      useValue: transactions === null ? null : new ReopenServiceUseCase(transactions, systemClock),
    },
    {
      provide: CloseServiceCategoryUseCase,
      useValue:
        categories === null ? null : new CloseServiceCategoryUseCase(categories, systemClock),
    },
    {
      provide: ReopenServiceCategoryUseCase,
      useValue:
        categories === null ? null : new ReopenServiceCategoryUseCase(categories, systemClock),
    },
  ];
}

export function catalogProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
): Provider[] {
  const transactions = database === undefined ? null : createServiceTransactions(database, ids);
  const packages = database === undefined ? null : createPackageTypeTransactions(database, ids);
  const categories =
    database === undefined ? null : createServiceCategoryTransactions(database, ids);
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
      useValue:
        transactions === null ? null : new UpdateServiceUseCase(transactions, systemClock),
    },
    {
      provide: CreateServiceCategoryUseCase,
      useValue:
        categories === null
          ? null
          : new CreateServiceCategoryUseCase(categories, ids, systemClock),
    },
    {
      provide: RenameServiceCategoryUseCase,
      useValue:
        categories === null ? null : new RenameServiceCategoryUseCase(categories, systemClock),
    },
    {
      provide: SetServiceCategoryBranchStateUseCase,
      useValue:
        categories === null
          ? null
          : new SetServiceCategoryBranchStateUseCase(categories, ids, systemClock),
    },
    ...closingProviders(transactions, categories),
  ];
}
