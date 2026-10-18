import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { employeeNumberCapabilityAccess } from './persistence/employee-context.adapter.ts';
import { createSetEmployeeNumberTransactions } from './persistence/set-employee-number.adapter.ts';
import {
  EMPLOYEE_NUMBER_CAPABILITY_ACCESS,
  type EmployeeNumberCapabilityAccess,
} from './queries/employee-number-capability.query.ts';
import { SetEmployeeNumberUseCase } from './use-cases/set-employee-number/set-employee-number.usecase.ts';

export function employeeNumberProviders(database: TenantWrappers | undefined, ids: IdGenerator): Provider[] {
  const capability: EmployeeNumberCapabilityAccess | null =
    database === undefined ? null : employeeNumberCapabilityAccess();
  return [{
    provide: SetEmployeeNumberUseCase,
    useValue: database === undefined ? null : new SetEmployeeNumberUseCase(createSetEmployeeNumberTransactions(database, ids)),
  }, {
    provide: EMPLOYEE_NUMBER_CAPABILITY_ACCESS,
    useValue: capability,
  }];
}
