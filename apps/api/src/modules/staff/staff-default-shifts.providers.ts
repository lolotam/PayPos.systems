import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { systemClock } from '../../shared/adapters/system-clock.ts';
import { createEmployeeDefaultShiftsTransactions, createEmployeeHoursReadAccess }
  from './persistence/employee-default-shifts.adapter.ts';
import { EMPLOYEE_HOURS_READ_ACCESS } from './queries/employee-default-shifts.query.ts';
import { SetEmployeeDefaultShiftsUseCase }
  from './use-cases/set-employee-default-shifts/set-employee-default-shifts.usecase.ts';

export function defaultShiftsProviders(database: TenantWrappers | undefined, ids: IdGenerator): Provider[] {
  return [
    { provide: EMPLOYEE_HOURS_READ_ACCESS, useValue: createEmployeeHoursReadAccess() },
    { provide: SetEmployeeDefaultShiftsUseCase, useValue: database === undefined ? null :
      new SetEmployeeDefaultShiftsUseCase(createEmployeeDefaultShiftsTransactions(database, ids), systemClock) },
  ];
}
