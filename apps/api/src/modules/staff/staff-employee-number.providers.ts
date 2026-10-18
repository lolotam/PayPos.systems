import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { employeeNumberCapabilityAccess } from './persistence/employee-context.adapter.ts';
import { createSetEmployeeNumberStartTransactions } from './persistence/set-employee-number-start.adapter.ts';
import { createSetEmployeeNumberTransactions } from './persistence/set-employee-number.adapter.ts';
import type { EmployeeNumberStartClock } from './ports/employee-number-start.port.ts';
import {
  EMPLOYEE_NUMBER_CAPABILITY_ACCESS,
  type EmployeeNumberCapabilityAccess,
} from './queries/employee-number-capability.query.ts';
import { SetEmployeeNumberStartUseCase } from './use-cases/set-employee-number-start/set-employee-number-start.usecase.ts';
import { SetEmployeeNumberUseCase } from './use-cases/set-employee-number/set-employee-number.usecase.ts';

export function employeeNumberProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  clock: EmployeeNumberStartClock,
): Provider[] {
  const capability: EmployeeNumberCapabilityAccess | null =
    database === undefined ? null : employeeNumberCapabilityAccess();
  return [{
    provide: SetEmployeeNumberUseCase,
    useValue: database === undefined ? null : new SetEmployeeNumberUseCase(createSetEmployeeNumberTransactions(database, ids)),
  }, {
    provide: SetEmployeeNumberStartUseCase,
    useValue:
      database === undefined
        ? null
        : new SetEmployeeNumberStartUseCase(createSetEmployeeNumberStartTransactions(database, ids), clock),
  }, {
    provide: EMPLOYEE_NUMBER_CAPABILITY_ACCESS,
    useValue: capability,
  }];
}
