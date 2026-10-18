import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { createSetEmployeeNumberTransactions } from './persistence/set-employee-number.adapter.ts';
import { SetEmployeeNumberUseCase } from './use-cases/set-employee-number/set-employee-number.usecase.ts';

export function employeeNumberProviders(database: TenantWrappers | undefined, ids: IdGenerator): Provider[] {
  return [{
    provide: SetEmployeeNumberUseCase,
    useValue: database === undefined ? null : new SetEmployeeNumberUseCase(createSetEmployeeNumberTransactions(database, ids)),
  }];
}
