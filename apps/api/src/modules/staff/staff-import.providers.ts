import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';

import { systemClock } from '../../shared/adapters/system-clock.ts';
import { createEmployeeImportTransactions } from './persistence/drizzle-employee-import.ts';
import {
  createImportSheetReader,
  createImportTemplateBuilder,
  createObjectBytesReader,
} from './persistence/import-adapters.ts';
import { CommitEmployeeImportUseCase } from './use-cases/commit-employee-import/commit-employee-import.usecase.ts';
import { GetEmployeeImportTemplateUseCase } from './use-cases/get-employee-import-template/get-employee-import-template.usecase.ts';
import { PreviewEmployeeImportUseCase } from './use-cases/preview-employee-import/preview-employee-import.usecase.ts';

/** مزوّدات استيراد الموظفين: قوالب ومعاينة وتثبيت الاستيراد، مفصولة لتقليل حجم ملف الوحدة. */
export function employeeImportProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  importStorage: { read(key: string, maxBytes: number): Promise<Uint8Array> } | null,
): Provider[] {
  const transactions =
    database === undefined ? null : createEmployeeImportTransactions(database, ids);
  return [
    {
      provide: GetEmployeeImportTemplateUseCase,
      useValue:
        transactions === null
          ? null
          : new GetEmployeeImportTemplateUseCase(transactions, createImportTemplateBuilder()),
    },
    {
      provide: PreviewEmployeeImportUseCase,
      useValue:
        transactions === null || importStorage === null
          ? null
          : new PreviewEmployeeImportUseCase(
              transactions,
              createObjectBytesReader(importStorage),
              createImportSheetReader(),
              ids,
              systemClock,
            ),
    },
    {
      provide: CommitEmployeeImportUseCase,
      useValue:
        transactions === null
          ? null
          : new CommitEmployeeImportUseCase(transactions, ids, systemClock),
    },
  ];
}
