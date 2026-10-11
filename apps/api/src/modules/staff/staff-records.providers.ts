import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { systemClock } from '../../shared/adapters/system-clock.ts';
import { GCC_BANKS } from '@pospay/domain';
import { SetEmployeeIbanUseCase } from './use-cases/set-employee-iban/set-employee-iban.usecase.ts';
import { createEmployeeIbanTransactions } from './persistence/drizzle-employee-iban-transactions.ts';
import { createEmployeeIbanAccess } from './persistence/employee-iban-access.adapter.ts';
import { EMPLOYEE_IBAN_ACCESS } from './queries/employee-iban.query.ts';
import { SetSalaryUseCase } from './use-cases/set-salary/set-salary.usecase.ts';
import { createSalaryTransactions } from './persistence/drizzle-salary-transactions.ts';
import { createSalaryAccess } from './persistence/employee-salary-access.adapter.ts';
import { SALARY_ACCESS } from './queries/salary-history.query.ts';
import { createDocumentTypeTransactions } from './persistence/drizzle-document-types.ts';
import { createEmployeeDocumentTransactions } from './persistence/drizzle-employee-documents.ts';
import { createEmployeeDocumentReadAccess } from './persistence/document-access.adapter.ts';
import { EMPLOYEE_DOCUMENT_ACCESS } from './queries/employee-documents.query.ts';
import { CreateDocumentTypeUseCase } from './use-cases/create-document-type/create-document-type.usecase.ts';
import { UpdateDocumentTypeUseCase } from './use-cases/update-document-type/update-document-type.usecase.ts';
import { DeactivateDocumentTypeUseCase } from './use-cases/deactivate-document-type/deactivate-document-type.usecase.ts';
import { ReactivateDocumentTypeUseCase } from './use-cases/reactivate-document-type/reactivate-document-type.usecase.ts';
import { RecordEmployeeDocumentUseCase } from './use-cases/record-employee-document/record-employee-document.usecase.ts';

export function salaryProviders(database: TenantWrappers | undefined, ids: IdGenerator): Provider[] {
  return [
    {
      provide: SetSalaryUseCase,
      useValue:
        database === undefined
          ? null
          : new SetSalaryUseCase(createSalaryTransactions(database, ids), ids),
    },
    { provide: SALARY_ACCESS, useValue: database === undefined ? null : createSalaryAccess() },
  ];
}

export function employeeIbanProviders(database: TenantWrappers | undefined, ids: IdGenerator): Provider[] {
  return [
    {
      provide: SetEmployeeIbanUseCase,
      useValue:
        database === undefined
          ? null
          : new SetEmployeeIbanUseCase(
              createEmployeeIbanTransactions(database, ids),
              ids,
              GCC_BANKS,
            ),
    },
    {
      provide: EMPLOYEE_IBAN_ACCESS,
      useValue: database === undefined ? null : createEmployeeIbanAccess(),
    },
  ];
}

export function documentProviders(database: TenantWrappers | undefined, ids: IdGenerator): Provider[] {
  const types = database === undefined ? null : createDocumentTypeTransactions(database, ids);
  const records = database === undefined ? null : createEmployeeDocumentTransactions(database, ids);
  return [
    {
      provide: EMPLOYEE_DOCUMENT_ACCESS,
      useValue: database === undefined ? null : createEmployeeDocumentReadAccess(systemClock),
    },
    {
      provide: CreateDocumentTypeUseCase,
      useValue: types === null ? null : new CreateDocumentTypeUseCase(types, ids),
    },
    {
      provide: UpdateDocumentTypeUseCase,
      useValue: types === null ? null : new UpdateDocumentTypeUseCase(types),
    },
    {
      provide: DeactivateDocumentTypeUseCase,
      useValue: types === null ? null : new DeactivateDocumentTypeUseCase(types),
    },
    {
      provide: ReactivateDocumentTypeUseCase,
      useValue: types === null ? null : new ReactivateDocumentTypeUseCase(types),
    },
    {
      provide: RecordEmployeeDocumentUseCase,
      useValue:
        records === null ? null : new RecordEmployeeDocumentUseCase(records, ids, systemClock),
    },
  ];
}
