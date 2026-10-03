import type { Provider } from '@nestjs/common';
import type { TenantWrappers } from '@pospay/db';
import { EmployeeSalariesController } from './http/employee-salaries.controller.ts';
import { SetSalaryUseCase } from './use-cases/set-salary/set-salary.usecase.ts';
import { createSalaryTransactions } from './persistence/drizzle-salary-transactions.ts';
import { createSalaryAccess } from './persistence/employee-salary-access.adapter.ts';
import { SALARY_ACCESS } from './queries/salary-history.query.ts';
import { systemUuidV7 } from '@pospay/ids';
import type { Redis } from 'ioredis';

import { systemClock } from '../../shared/adapters/system-clock.ts';
import { AttendanceQrController } from './http/attendance-qr.controller.ts';
import { EmployeesController } from './http/employees.controller.ts';
import { EmployeeDetailGuard } from './http/employee-detail.guard.ts';
import { createEmployeeDetailAccess } from './persistence/employee-detail-access.adapter.ts';
import { EMPLOYEE_DETAIL_ACCESS } from './queries/employee-detail.query.ts';
import { createEmployeeTransactions } from './persistence/drizzle-employee-transactions.ts';
import { CreateEmployeeUseCase } from './use-cases/create-employee/create-employee.usecase.ts';
import { UpdateEmployeeUseCase } from './use-cases/update-employee/update-employee.usecase.ts';
import { createEmployeeUpdateTransactions } from './persistence/drizzle-employee-update.ts';
import { hmacAttendanceQr } from './persistence/hmac-attendance-qr.ts';
import { createRedisAttendanceQrSecrets } from './persistence/redis-attendance-qr-secrets.ts';
import { createAttendanceBranchReader } from './persistence/tenancy-attendance-branch.adapter.ts';
import { IssueAttendanceQr } from './use-cases/issue-attendance-qr/issue-attendance-qr.ts';
import { VerifyAttendanceQr } from './use-cases/verify-attendance-qr/verify-attendance-qr.ts';

export const staffControllers = [
  AttendanceQrController,
  EmployeesController,
  EmployeeSalariesController,
];

export function staffProviders(database?: TenantWrappers, redis?: Redis): Provider[] {
  const ids = systemUuidV7();
  const secrets = redis === undefined ? null : createRedisAttendanceQrSecrets(redis);
  const branches = database === undefined ? null : createAttendanceBranchReader(database);
  return [
    {
      provide: SetSalaryUseCase,
      useValue:
        database === undefined
          ? null
          : new SetSalaryUseCase(createSalaryTransactions(database, ids), ids),
    },
    { provide: SALARY_ACCESS, useValue: database === undefined ? null : createSalaryAccess() },
    {
      provide: UpdateEmployeeUseCase,
      useValue:
        database === undefined
          ? null
          : new UpdateEmployeeUseCase(createEmployeeUpdateTransactions(database, ids), ids),
    },
    EmployeeDetailGuard,
    {
      provide: EMPLOYEE_DETAIL_ACCESS,
      useValue: database === undefined ? null : createEmployeeDetailAccess(),
    },
    {
      provide: CreateEmployeeUseCase,
      useValue:
        database === undefined
          ? null
          : new CreateEmployeeUseCase(createEmployeeTransactions(database, ids), ids, systemClock),
    },
    {
      provide: IssueAttendanceQr,
      useValue:
        branches === null || secrets === null
          ? null
          : new IssueAttendanceQr(branches, secrets, hmacAttendanceQr, systemClock),
    },
    {
      provide: VerifyAttendanceQr,
      useValue:
        branches === null || secrets === null
          ? null
          : new VerifyAttendanceQr(branches, secrets, hmacAttendanceQr, systemClock),
    },
  ];
}
