import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';

import type { Clock } from '../../shared/ports/clock.port.ts';
import { systemClock } from '../../shared/adapters/system-clock.ts';
import { CommissionPlanVersionsController } from './http/commission-plan-versions.controller.ts';
import { CommissionPlanEmployeesController } from './http/commission-plan-employees.controller.ts';
import { CommissionServiceOverridesController } from './http/commission-service-overrides.controller.ts';
import {
  createCommissionServiceOverrideListReaders,
  type CommissionServiceOverrideListReadProviders,
} from './persistence/commission-service-override-list-readers.ts';
import { createCommissionPlanVersionTransactions } from './persistence/drizzle-commission-plan-version-transactions.ts';
import { createCommissionServiceOverrideTransactions } from './persistence/drizzle-commission-service-override-transactions.ts';
import type { CommissionPlanVersionReaders } from './persistence/commission-plan-version-scope.ts';
import type { CommissionServiceReaderPort } from './ports/commission-service-reader.port.ts';
import {
  COMMISSION_SERVICE_OVERRIDE_LIST_READS,
  type CommissionServiceOverrideListReadsFactory,
} from './queries/commission-service-overrides.query.ts';
import {
  COMMISSION_PLAN_EMPLOYEE_LIST,
  createCommissionPlanEmployeeList,
  type CommissionPlanEmployeeListReads,
} from './queries/commission-plan-employees.query.ts';
import { CreateCommissionPlanVersionUseCase } from './use-cases/create-commission-plan-version/create-commission-plan-version.usecase.ts';
import { CreateCommissionServiceOverrideUseCase } from './use-cases/create-commission-service-override/create-commission-service-override.usecase.ts';

export const commissionsControllers = [
  CommissionPlanVersionsController,
  CommissionServiceOverridesController,
  CommissionPlanEmployeesController,
];

/**
 * قراء الكاتبين: تقويم النشاط وقفل الموظفة وإعادة فحص الصلاحية، مع قارئ وجود الخدمة.
 * قارئ الخدمة للكتابة بس؛ مسار القراءة بياخد وقته من مزوديه بجوار الاستعلام.
 */
export interface CommissionModuleReaders extends CommissionPlanVersionReaders {
  readonly serviceReader: CommissionServiceReaderPort['exists'];
}

export function commissionsProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  readers: CommissionModuleReaders,
  listReads: CommissionServiceOverrideListReadProviders,
  employeeListReads: CommissionPlanEmployeeListReads,
  clock: Clock = systemClock,
): Provider[] {
  // الفحص البنيوي هنا: شكل المهايئ لازم يطابق مصنع القراءة بجوار الاستعلام.
  const listReaders: CommissionServiceOverrideListReadsFactory =
    createCommissionServiceOverrideListReaders(listReads);
  return [
    {
      provide: CreateCommissionPlanVersionUseCase,
      useValue:
        database === undefined
          ? null
          : new CreateCommissionPlanVersionUseCase(
              createCommissionPlanVersionTransactions(database, ids, readers),
              ids,
              clock,
            ),
    },
    {
      provide: CreateCommissionServiceOverrideUseCase,
      useValue:
        database === undefined
          ? null
          : new CreateCommissionServiceOverrideUseCase(
              createCommissionServiceOverrideTransactions(database, ids, readers),
              ids,
              clock,
            ),
    },
    { provide: COMMISSION_SERVICE_OVERRIDE_LIST_READS, useValue: listReaders },
    {
      provide: COMMISSION_PLAN_EMPLOYEE_LIST,
      useValue:
        database === undefined
          ? null
          : createCommissionPlanEmployeeList(database, employeeListReads),
    },
  ];
}
