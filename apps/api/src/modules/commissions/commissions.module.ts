import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';

import type { Clock } from '../../shared/ports/clock.port.ts';
import { systemClock } from '../../shared/adapters/system-clock.ts';
import { CommissionPlanVersionsController } from './http/commission-plan-versions.controller.ts';
import { CommissionPlanEmployeesController } from './http/commission-plan-employees.controller.ts';
import { CommissionServiceOverridesController } from './http/commission-service-overrides.controller.ts';
import { CommissionOverrideServicesController } from './http/commission-override-services.controller.ts';
import { CommissionBlockedCorrectionsController } from './http/commission-blocked-corrections.controller.ts';
import {
  GET_COMMISSION_ESTIMATE,
  CommissionEstimateController,
} from './http/commission-estimate.controller.ts';
import { createCommissionEstimateReader } from './persistence/commission-estimate-reader.ts';
import type { CommissionEstimateProviders } from './persistence/commission-estimate-providers.ts';
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
import {
  COMMISSION_BLOCKED_CORRECTION_LIST,
  createCommissionBlockedCorrectionList,
  type CommissionBlockedCorrectionListReads,
} from './queries/commission-blocked-corrections.query.ts';
import { CreateCommissionPlanVersionUseCase } from './use-cases/create-commission-plan-version/create-commission-plan-version.usecase.ts';
import { CreateCommissionServiceOverrideUseCase } from './use-cases/create-commission-service-override/create-commission-service-override.usecase.ts';
import { GetCommissionEstimateUseCase } from './use-cases/get-commission-estimate/get-commission-estimate.usecase.ts';

export const commissionsControllers = [
  CommissionPlanVersionsController,
  CommissionServiceOverridesController,
  CommissionOverrideServicesController,
  CommissionPlanEmployeesController,
  CommissionBlockedCorrectionsController,
  CommissionEstimateController,
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
  blockedCorrectionListReads: CommissionBlockedCorrectionListReads,
  estimateProviders: CommissionEstimateProviders,
  clock: Clock = systemClock,
): Provider[] {
  return [
    ...commissionWriteProviders(database, ids, readers, clock),
    ...commissionReadProviders(database, listReads, employeeListReads, blockedCorrectionListReads),
    {
      provide: GET_COMMISSION_ESTIMATE,
      useValue:
        database === undefined
          ? null
          : new GetCommissionEstimateUseCase(
              createCommissionEstimateReader(database, estimateProviders),
            ),
    },
  ];
}

/** مزودو الكتابة: إصدار الخطة وتجاوز الخدمة، وهما كل واحد في معاملته. */
function commissionWriteProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  readers: CommissionModuleReaders,
  clock: Clock,
): Provider[] {
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
  ];
}

/** مزودو القراءة: قوائم الخطط والتجاوزات والموظفين والتصحيحات الموقوفة. */
function commissionReadProviders(
  database: TenantWrappers | undefined,
  listReads: CommissionServiceOverrideListReadProviders,
  employeeListReads: CommissionPlanEmployeeListReads,
  blockedCorrectionListReads: CommissionBlockedCorrectionListReads,
): Provider[] {
  const listReaders: CommissionServiceOverrideListReadsFactory =
    createCommissionServiceOverrideListReaders(listReads);
  return [
    { provide: COMMISSION_SERVICE_OVERRIDE_LIST_READS, useValue: listReaders },
    {
      provide: COMMISSION_PLAN_EMPLOYEE_LIST,
      useValue:
        database === undefined
          ? null
          : createCommissionPlanEmployeeList(database, employeeListReads),
    },
    {
      provide: COMMISSION_BLOCKED_CORRECTION_LIST,
      useValue:
        database === undefined
          ? null
          : createCommissionBlockedCorrectionList(database, blockedCorrectionListReads),
    },
  ];
}
