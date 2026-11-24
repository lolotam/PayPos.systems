import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';

import type { Clock } from '../../shared/ports/clock.port.ts';
import { systemClock } from '../../shared/adapters/system-clock.ts';
import { CommissionPlanVersionsController } from './http/commission-plan-versions.controller.ts';
import { CommissionPeriodRepairsController } from './http/commission-period-repairs.controller.ts';
import { CommissionPlanEmployeesController } from './http/commission-plan-employees.controller.ts';
import { CommissionServiceOverridesController } from './http/commission-service-overrides.controller.ts';
import { CommissionOverrideServicesController } from './http/commission-override-services.controller.ts';
import { CommissionBlockedCorrectionsController } from './http/commission-blocked-corrections.controller.ts';
import {
  CommissionStatementsController,
  GET_COMMISSION_STATEMENT,
} from './http/commission-statements.controller.ts';
import {
  GET_COMMISSION_ESTIMATE,
  CommissionEstimateController,
} from './http/commission-estimate.controller.ts';
import { createCommissionEstimateReader } from './persistence/commission-estimate-reader.ts';
import type { CommissionEstimateProviders } from './persistence/commission-estimate-providers.ts';
import { CanonicalSha256FingerprintHasher } from './persistence/canonical-sha256-fingerprint-hasher.ts';
import { createCommissionStatementReader } from './persistence/commission-statement-reader.ts';
import { createCommissionStatementGenerateTransactions } from './persistence/drizzle-commission-statement-generate-transactions.ts';
import type { CommissionStatementGenerateReaders } from './persistence/commission-statement-generate-scope.ts';
import { createCommissionStatementReviewTransactions } from './persistence/drizzle-commission-statement-review-transactions.ts';
import type { CommissionStatementReviewReaders } from './persistence/commission-statement-review-scope.ts';
import type { CommissionStatementProviders } from './ports/commission-statement-providers.port.ts';
import {
  createCommissionServiceOverrideListReaders,
  type CommissionServiceOverrideListReadProviders,
} from './persistence/commission-service-override-list-readers.ts';
import { createCommissionPeriodRepairTransactions } from './persistence/drizzle-commission-period-repair-transactions.ts';
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
import { RepairCommissionPeriodUseCase } from './use-cases/repair-commission-period/repair-commission-period.usecase.ts';
import { CreateCommissionPlanVersionUseCase } from './use-cases/create-commission-plan-version/create-commission-plan-version.usecase.ts';
import { CreateCommissionServiceOverrideUseCase } from './use-cases/create-commission-service-override/create-commission-service-override.usecase.ts';
import { GetCommissionEstimateUseCase } from './use-cases/get-commission-estimate/get-commission-estimate.usecase.ts';
import { GenerateCommissionStatementUseCase } from './use-cases/generate-statement/generate-statement.usecase.ts';
import { GetCommissionStatementUseCase } from './use-cases/get-statement/get-statement.usecase.ts';
import { ReviewCommissionStatementUseCase } from './use-cases/review-statement/review-statement.usecase.ts';
import { ReturnCommissionStatementUseCase } from './use-cases/return-statement/return-statement.usecase.ts';

export const commissionsControllers = [
  CommissionPlanVersionsController,
  CommissionPeriodRepairsController,
  CommissionServiceOverridesController,
  CommissionOverrideServicesController,
  CommissionPlanEmployeesController,
  CommissionBlockedCorrectionsController,
  CommissionEstimateController,
  CommissionStatementsController,
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
  statement: CommissionStatementBindings,
  clock: Clock = systemClock,
): Provider[] {
  return [
    ...commissionWriteProviders(database, ids, readers, clock),
    ...commissionReadProviders(database, listReads, employeeListReads, blockedCorrectionListReads),
    ...commissionStatementProviders(database, ids, statement, clock),
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

/**
 * ما بيربطه الجذر لكشف العمولة: مزودو المصادر من الوحدات صاحبة البيانات، وفحص «الإنشاء والمراجعة»
 * من identity، وتقويم النشاط (spec 059 D-16).
 */
export interface CommissionStatementBindings {
  readonly providers: CommissionStatementProviders;
  readonly reviewAccess: CommissionStatementGenerateReaders['reviewAccess'];
  readonly businessCalendar: CommissionStatementGenerateReaders['businessCalendar'];
  /** فحص الإرجاع: صاحب مراجعة أو صاحب اعتماد، وكلهم قارئ على مستوى النشاط كله (FR-031). */
  readonly returnAccess: CommissionStatementReviewReaders['returnAccess'];
  /** عضوية الفاعل اللي بتتسجل مع المراجعة أو الإرجاع (FR-029، FR-031). */
  readonly actorMembership: CommissionStatementReviewReaders['actorMembership'];
  /** أصحاب صلاحية الاعتماد: مستلمو إشعار «الكشف مستني الاعتماد» (FR-030). */
  readonly approvers: CommissionStatementReviewReaders['approvers'];
  /** قواعد التنبيه: بتشغيل النوع وقناته بس (DR-008). */
  readonly alertRules: CommissionStatementReviewReaders['alertRules'];
}

/** مزودو الكشف: القراءة (GET) والإنشاء (generate) على نفس مزودي المصادر ونفس منفذ التجزئة. */
function commissionStatementProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  statement: CommissionStatementBindings,
  clock: Clock,
): Provider[] {
  const hasher = new CanonicalSha256FingerprintHasher();
  return [
    {
      provide: GET_COMMISSION_STATEMENT,
      useValue:
        database === undefined
          ? null
          : new GetCommissionStatementUseCase(
              createCommissionStatementReader(database, statement.providers),
              hasher,
            ),
    },
    {
      provide: GenerateCommissionStatementUseCase,
      useValue:
        database === undefined
          ? null
          : new GenerateCommissionStatementUseCase(
              createCommissionStatementGenerateTransactions(database, ids, {
                businessCalendar: statement.businessCalendar,
                reviewAccess: statement.reviewAccess,
                providers: statement.providers,
              }),
              hasher,
              clock,
            ),
    },
    ...commissionStatementReviewProviders(database, ids, statement, clock, hasher),
  ];
}

/** مزودو المراجعة والإرجاع: نفس حد المعاملة ونفس القراء (52-1). */
function commissionStatementReviewProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  statement: CommissionStatementBindings,
  clock: Clock,
  hasher: CanonicalSha256FingerprintHasher,
): Provider[] {
  const transactions = (db: TenantWrappers) =>
    createCommissionStatementReviewTransactions(db, ids, {
      businessCalendar: statement.businessCalendar,
      reviewAccess: statement.reviewAccess,
      returnAccess: statement.returnAccess,
      providers: statement.providers,
      actorMembership: statement.actorMembership,
      approvers: statement.approvers,
      alertRules: statement.alertRules,
    });
  return [
    {
      provide: ReviewCommissionStatementUseCase,
      useValue:
        database === undefined
          ? null
          : new ReviewCommissionStatementUseCase(transactions(database), hasher, clock),
    },
    {
      provide: ReturnCommissionStatementUseCase,
      useValue:
        database === undefined ? null : new ReturnCommissionStatementUseCase(transactions(database), clock),
    },
  ];
}

/** مزودو الكتابة: إصدار الخطة وإصلاح الشهر وتجاوز الخدمة، وكل واحد في معاملته. */
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
      provide: RepairCommissionPeriodUseCase,
      useValue:
        database === undefined
          ? null
          : new RepairCommissionPeriodUseCase(
              createCommissionPeriodRepairTransactions(database, ids, readers, clock),
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
