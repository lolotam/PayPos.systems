import { PackageTypesController } from './http/package-types.controller.ts';
import { SellablePackageTypesController } from './http/sellable-package-types.controller.ts';
import { BranchServiceCategoriesController } from './http/branch-service-categories.controller.ts';
import { ServiceCategoriesController } from './http/service-categories.controller.ts';
import { ServiceCategoryClosingsController } from './http/service-category-closings.controller.ts';
import { ServiceImportController } from './http/service-import.controller.ts';
import { createServiceImportTransactions } from './persistence/drizzle-service-import.ts';
import { createServiceImportTemplateBuilder } from './persistence/service-import-template.ts';
import { createPackageTypeTransactions } from './persistence/drizzle-package-type-transactions.ts';
import { createServiceCategoryTransactions } from './persistence/drizzle-service-category-transactions.ts';
import { readSellablePackageSalePlace } from './persistence/package-sale-place.adapter.ts';
import { SELLABLE_PACKAGE_PLACE } from './queries/sellable-package-types.query.ts';
import { CreatePackageTypeUseCase } from './use-cases/create-package-type/create-package-type.usecase.ts';
import { ResumeSellingPackageTypeUseCase } from './use-cases/resume-selling-package-type/resume-selling-package-type.usecase.ts';
import { StopSellingPackageTypeUseCase } from './use-cases/stop-selling-package-type/stop-selling-package-type.usecase.ts';
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
import { createServiceImportSheetReader } from './persistence/service-import-adapters.ts';
import { CloseServiceUseCase } from './use-cases/close-service/close-service.usecase.ts';
import { CreateServiceUseCase } from './use-cases/create-service/create-service.usecase.ts';
import { ReopenServiceUseCase } from './use-cases/reopen-service/reopen-service.usecase.ts';
import { UpdateServiceUseCase } from './use-cases/update-service/update-service.usecase.ts';
import { GetServiceImportTemplateUseCase } from './use-cases/get-service-import-template/get-service-import-template.usecase.ts';
import { PreviewServiceImportUseCase } from './use-cases/preview-service-import/preview-service-import.usecase.ts';
import { CommitServiceImportUseCase } from './use-cases/commit-service-import/commit-service-import.usecase.ts';
import type {
  ServiceImportFilesBinding,
} from './persistence/service-import-adapters.ts';

export const catalogControllers = [
  // مسار الاستيراد الثابت أولاً حتى لا يبتلعه route الخدمة ذات المعرّف (FR-003).
  ServiceImportController,
  ServicesController,
  PackageTypesController,
  SellablePackageTypesController,
  ServiceCategoriesController,
  ServiceCategoryClosingsController,
  BranchServiceCategoriesController,
];

type ServiceTx = ReturnType<typeof createServiceTransactions> | null;
type CategoryTx = ReturnType<typeof createServiceCategoryTransactions> | null;

/** مزوّدو قفل وفتح التصنيفات والخدمات، منفصلون عشان قائمة المزوّدين الرئيسية تفضل في حد الدالة. */
function closingProviders(
  transactions: ServiceTx,
  categories: CategoryTx,
  ids: IdGenerator,
): Provider[] {
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
        categories === null ? null : new CloseServiceCategoryUseCase(categories, systemClock, ids),
    },
    {
      provide: ReopenServiceCategoryUseCase,
      useValue:
        categories === null ? null : new ReopenServiceCategoryUseCase(categories, systemClock, ids),
    },
  ];
}

/**
 * مزوّدو استيراد الخدمات: القالب من قاعدة البيانات وحدها، والمعاينة تحتاج ربطات الملفات
 * المربوطة عند التركيب في app.ts؛ بلا تخزين تعطّل المعاينة وحدها ولا يُعطَّل القالب.
 */
function serviceImportProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  files: ServiceImportFilesBinding | null,
): Provider[] {
  // الكترولر مسجّل دائمًا، فيجب تسجيل الرمزين دائمًا — بلا قاعدة بيانات يكونان null
  // لتقف المسارات على NOT_READY/STORAGE_NOT_CONFIGURED بدل كسر إقلاع Nest (P1 مراجعة 1186).
  if (database === undefined)
    return [
      { provide: GetServiceImportTemplateUseCase, useValue: null },
      { provide: PreviewServiceImportUseCase, useValue: null },
      { provide: CommitServiceImportUseCase, useValue: null },
    ];
  const transactions = createServiceImportTransactions(database, files?.fileFacts ?? null, ids);
  const bytes = files?.bytes ?? null;
  return [
    {
      provide: GetServiceImportTemplateUseCase,
      useValue: new GetServiceImportTemplateUseCase(
        transactions,
        createServiceImportTemplateBuilder(),
      ),
    },
    {
      // التخزين غير المهيأ يعطّل المعاينة وحدها بقيمة null؛ التوكن يظل مسجلاً ليقف الحاقن.
      provide: PreviewServiceImportUseCase,
      useValue:
        bytes === null
          ? null
          : new PreviewServiceImportUseCase(
              transactions,
              bytes,
              createServiceImportSheetReader(),
              ids,
              systemClock,
            ),
    },
    {
      // القبول لا يحتاج تخزيناً: الطلب وحدثه يُكتبان في معاملة واحدة مع قفل المعاينة.
      provide: CommitServiceImportUseCase,
      useValue: new CommitServiceImportUseCase(transactions, systemClock),
    },
  ];
}

/** مزوّدو أنواع الباقات، منفصلون عشان جسم الدالة الرئيسية يفضل تحت حد الأسطر. */
function packageTypeProviders(
  packages: ReturnType<typeof createPackageTypeTransactions> | null,
  ids: IdGenerator,
): Provider[] {
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
      provide: StopSellingPackageTypeUseCase,
      useValue: packages === null ? null : new StopSellingPackageTypeUseCase(packages, systemClock),
    },
    {
      provide: ResumeSellingPackageTypeUseCase,
      useValue:
        packages === null ? null : new ResumeSellingPackageTypeUseCase(packages, systemClock),
    },
  ];
}

export function catalogProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  files?: ServiceImportFilesBinding | null,
): Provider[] {
  const transactions = database === undefined ? null : createServiceTransactions(database, ids);
  const packages = database === undefined ? null : createPackageTypeTransactions(database, ids);
  const categories =
    database === undefined ? null : createServiceCategoryTransactions(database, ids);
  return [
    {
      provide: SELLABLE_PACKAGE_PLACE,
      useValue: readSellablePackageSalePlace,
    },
    ...packageTypeProviders(packages, ids),
    {
      provide: CreateServiceUseCase,
      useValue:
        transactions === null ? null : new CreateServiceUseCase(transactions, ids, systemClock),
    },
    {
      provide: UpdateServiceUseCase,
      useValue: transactions === null ? null : new UpdateServiceUseCase(transactions, systemClock),
    },
    {
      provide: CreateServiceCategoryUseCase,
      useValue:
        categories === null ? null : new CreateServiceCategoryUseCase(categories, ids, systemClock),
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
    ...closingProviders(transactions, categories, ids),
    ...serviceImportProviders(database, ids, files ?? null),
  ];
}
