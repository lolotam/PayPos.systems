import type { Type, Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { PackageImportCommitController } from './http/package-import-commit.controller.ts';
import { PackageImportPreviewController } from './http/package-import-preview.controller.ts';
import { createPackageImportCommitTransactions } from './persistence/package-import-commit.transactions.ts';
import { createPackageImportRequestTransactions } from './persistence/package-import-request.transactions.ts';
import { createPackageImportTemplateBuilder } from './persistence/package-import-template.ts';
import { createPackageImportTemplateTransactions } from './persistence/package-import-template.transactions.ts';
import type { Clock } from './ports/service-session-transactions.port.ts';
import { databaseProvider as fromDb } from './orders-provider-factories.ts';
import { CommitPackageImportUseCase } from './use-cases/commit-package-import/commit-package-import.usecase.ts';
import { GetPackageImportTemplateUseCase } from './use-cases/get-package-import-template/get-package-import-template.usecase.ts';
import { RequestPackageImportPreviewUseCase } from './use-cases/request-package-import-preview/request-package-import-preview.usecase.ts';

/** متحكمات استيراد الباقات: المعاينة، ثم القالب والتثبيت (47-2d). */
export const packageImportControllers: Type[] = [
  PackageImportPreviewController,
  PackageImportCommitController,
];

/**
 * مزودو استيراد الباقات الثلاثة: طلب المعاينة، وتنزيل القالب، وقبول التثبيت؛ كلها null عند غياب
 * قاعدة البيانات فيرد المتحكم NOT_READY بدل أن ينهار التطبيق عند الإقلاع.
 *
 * @param database بوابة المستأجر أو undefined
 * @param ids مولّد المعرّفات
 * @param clock الساعة المحقونة
 * @returns مزودو حالات الاستخدام
 */
export function packageImportProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  clock: Clock,
): Provider[] {
  return [
    fromDb(
      RequestPackageImportPreviewUseCase,
      database,
      (db: TenantWrappers) =>
        new RequestPackageImportPreviewUseCase(
          createPackageImportRequestTransactions(db, ids),
          ids,
          clock,
        ),
    ),
    fromDb(
      GetPackageImportTemplateUseCase,
      database,
      (db: TenantWrappers) =>
        new GetPackageImportTemplateUseCase(
          createPackageImportTemplateTransactions(db),
          createPackageImportTemplateBuilder(),
        ),
    ),
    fromDb(
      CommitPackageImportUseCase,
      database,
      (db: TenantWrappers) =>
        new CommitPackageImportUseCase(createPackageImportCommitTransactions(db, ids), clock),
    ),
  ];
}
