import {
  commissionCorrectionBlockedNoticeGroupSize,
  commissionCorrectionBlockedNoticeRequested,
  commissionEventParkedNoticeGroupSize,
  commissionEventParkedNoticeRequested,
} from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import { COMMISSION_INPUT_EVENT_TYPES, COMMISSION_INPUTS_CONSUMER_ID } from '@pospay/domain';

import type { OutboxConsumer } from '../../outbox/consumer.ts';
import { onCommissionInputEvent } from './events/handlers/on-commission-input-event.handler.ts';
import { createParkedCommissionAlertNotifier } from './persistence/parked-commission-alert.outbox.ts';
import {
  RaiseParkedCommissionAlert,
  type ParkedAlertOutcome,
  type ParkedCommissionEvent,
} from './use-cases/raise-parked-commission-alert/raise-parked-commission-alert.ts';
import type { ParkedAlertOwnersReader } from './ports/parked-commission-alert.port.ts';
import {
  runSessionTipsBootstrap,
  type SessionTipsBootstrapResult,
  type SessionTipsBootstrapScope,
} from './use-cases/bootstrap-session-tips/bootstrap-session-tips.ts';
import {
  createCommissionLineProjectionScope,
  type BusinessTimeZoneReader,
} from './persistence/commission-line-projection.scope.ts';
import { createCommissionCorrectionScope } from '@pospay/commissions-posting';
import { createCommissionBlockNotices } from './persistence/commission-block-notice.outbox.ts';
import { markCommissionEventConsumed } from './persistence/commission-event-consumption.ts';
import { createCoverageProjectionReader } from './persistence/commission-coverage.reads.ts';
import type { CommissionPermissionHoldersReader } from './ports/commission-block-notice.port.ts';
import type {
  CoverageBusinessReader,
  CoverageCompanyReader,
  CoverageRetainedPageReader,
  PackageSaleCoverageReader,
  SalaryCoverageReader,
  ServiceLineCoverageReader,
} from './ports/commission-coverage.port.ts';
import {
  runCommissionCoverageReport,
  type CommissionCoverageReport,
  type CommissionCoverageScope,
} from './use-cases/report-commission-coverage/report-commission-coverage.ts';
import { commissionStatementExportTransactions } from './persistence/commission-statement-export.transactions.ts';
import {
  createCommissionSalaryProjectionScope,
  createCommissionTipProjectionScope,
  type BusinessCalendarReader,
  type EmployeeBusinessReader,
} from './persistence/commission-tip-salary-projection.scope.ts';
import { createCommissionSaleProjectionScope } from './persistence/commission-sale-projection.scope.ts';
import type { Clock, IdGenerator } from './ports/commission-line-projection.port.ts';
import type { CurrentTipSessionsReader } from './ports/commission-tip-bootstrap.port.ts';
import { ProjectSalary } from './use-cases/project-salary/project-salary.ts';
import { ProjectPackageSale } from './use-cases/project-package-sale/project-package-sale.ts';
import { ProjectServiceLines } from './use-cases/project-service-lines/project-service-lines.ts';
import { ProjectSessionTips } from './use-cases/project-session-tips/project-session-tips.ts';
import type { CommissionStatementExportData } from './ports/commission-statement-export.port.ts';
import {
  commissionStatementExportRequestStatement,
  commissionStatementFrozenRowsStatement,
} from './queries/commission-statement-export.query.ts';
import { ReadCommissionStatementExport } from './use-cases/read-commission-statement-export/read-commission-statement-export.ts';

/** قارئ تصدير كشف العمولة في الـ worker؛ مصنع مستقل عن طوابير وظائف العمولات. */
export function createCommissionStatementExportReader(
  database: Pick<TenantWrappers, 'withTenant'>,
) {
  const useCase = new ReadCommissionStatementExport(
    commissionStatementExportTransactions(database, {
      request: commissionStatementExportRequestStatement,
      rows: commissionStatementFrozenRowsStatement,
    }),
  );
  return (
    companyId: string,
    renderId: string,
    signal?: AbortSignal,
  ): Promise<CommissionStatementExportData> => useCase.execute(companyId, renderId, signal);
}

// الهوية والأنواع الستة ثوابت في @pospay/domain يقرؤها التسجيل هنا. دالة العدّ كُتبت قيمها حرفيًا في SQL، واختبار الدالة
// المثبّتة يقارن تلك القيم بهذه الثوابت؛ التهيئة والتقرير يستعملان نفس الهوية.
export { COMMISSION_INPUTS_CONSUMER_ID };

export interface CommissionInputsConsumerDependencies {
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly businessTimeZone: BusinessTimeZoneReader;
  readonly employeeBusiness: EmployeeBusinessReader;
  readonly businessCalendar: BusinessCalendarReader;
  readonly permissionHolders: CommissionPermissionHoldersReader<Tx>;
}

const commissionBlockNoticeContract = {
  groupSize: commissionCorrectionBlockedNoticeGroupSize,
  parsePayload: (payload: unknown) => commissionCorrectionBlockedNoticeRequested.parse(payload),
};

/** يربط مستهلك مدخلات العمولة بقارئ المنطقة الزمنية وبالساعة والمولّد المحقونين من الجذر. */
export function createCommissionInputsConsumer(
  dependencies: CommissionInputsConsumerDependencies,
): OutboxConsumer {
  const bind = (tx: Tx) => {
    const corrections = createCommissionCorrectionScope(tx, dependencies.ids, dependencies.clock);
    const notices = createCommissionBlockNotices(tx, dependencies.ids, dependencies.clock, {
      ...commissionBlockNoticeContract,
      permissionHolders: dependencies.permissionHolders,
    });
    return {
      lines: new ProjectServiceLines(
        createCommissionLineProjectionScope(tx, dependencies.businessTimeZone),
        dependencies.clock,
        dependencies.ids,
        corrections,
        notices,
      ),
      tips: new ProjectSessionTips(
        createCommissionTipProjectionScope(tx, dependencies.businessTimeZone, dependencies.ids),
        dependencies.clock,
        dependencies.ids,
        corrections,
        notices,
      ),
      salary: new ProjectSalary(
        createCommissionSalaryProjectionScope(
          tx,
          dependencies.businessCalendar,
          dependencies.employeeBusiness,
        ),
        dependencies.clock,
        dependencies.ids,
        corrections,
        notices,
      ),
      sales: new ProjectPackageSale(
        createCommissionSaleProjectionScope(tx, dependencies.businessTimeZone, dependencies.ids),
        dependencies.clock,
        dependencies.ids,
        corrections,
        notices,
      ),
    };
  };
  return {
    id: COMMISSION_INPUTS_CONSUMER_ID,
    eventTypes: [...COMMISSION_INPUT_EVENT_TYPES],
    handle: (tx, event) => onCommissionInputEvent(bind(tx), event),
  };
}

/** ما يحتاجه تنبيه الحدث الموقوف: معاملة الشركة ومالكيها ومولّد الهوية والساعة. */
export interface ParkedCommissionAlertDependencies {
  readonly database: Pick<TenantWrappers, 'withTenant'>;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly owners: ParkedAlertOwnersReader<Tx>;
}

/** يربط تنبيه الحدث الموقوف بمعاملة الشركة وبمالكيها وبمولّد هوية الجرس. */
export function createParkedCommissionAlert(
  dependencies: ParkedCommissionAlertDependencies,
): (event: ParkedCommissionEvent) => Promise<ParkedAlertOutcome> {
  const alert = new RaiseParkedCommissionAlert<Tx>({
    withTenant: dependencies.database.withTenant,
    owners: dependencies.owners,
    markConsumed: markCommissionEventConsumed,
    appendNotice: createParkedCommissionAlertNotifier(
      dependencies.ids,
      (payload) => commissionEventParkedNoticeRequested.parse(payload),
    ),
    now: () => dependencies.clock.now(),
    groupSize: commissionEventParkedNoticeGroupSize,
  });
  return (event) => alert.execute(event);
}

/** يربط مشغّل تهيئة البقشيش بالقارئ وبإسقاط البقشيش وبمعرّف المستهلك نفسه. */
export function createCommissionTipsBootstrap(
  dependencies: CommissionInputsConsumerDependencies & {
    readonly database: Pick<TenantWrappers, 'withTenant'>;
    readonly tipsReader: CurrentTipSessionsReader;
  },
): (scope: SessionTipsBootstrapScope) => Promise<SessionTipsBootstrapResult> {
  return (scope) =>
    runSessionTipsBootstrap(
      {
        withTenant: dependencies.database.withTenant,
        reader: dependencies.tipsReader,
        consumerId: COMMISSION_INPUTS_CONSUMER_ID,
        markConsumed: markCommissionEventConsumed,
        tipsFor: (tx) =>
          new ProjectSessionTips(
            createCommissionTipProjectionScope(tx, dependencies.businessTimeZone, dependencies.ids),
            dependencies.clock,
            dependencies.ids,
            // نطاق التصحيح يُبنى ولا يُستعمل: التهيئة بلا حدث مرفوضة قبل أي هدف مغلق (CS-Q45).
            createCommissionCorrectionScope(tx, dependencies.ids, dependencies.clock),
            createCommissionBlockNotices(tx, dependencies.ids, dependencies.clock, {
              ...commissionBlockNoticeContract,
              permissionHolders: dependencies.permissionHolders,
            }),
          ),
      },
      scope,
    );
}

/** يربط تقرير تغطية العمولات بقارئات المصدر والإسقاط وبمعرّف المستهلك الثابت. */
export function createCommissionCoverageReport(dependencies: {
  readonly database: Pick<TenantWrappers, 'withTenant'>;
  readonly lines: ServiceLineCoverageReader;
  readonly salaries: SalaryCoverageReader;
  readonly sales: PackageSaleCoverageReader;
  readonly retained: CoverageRetainedPageReader;
  readonly companies: CoverageCompanyReader;
  readonly businesses: CoverageBusinessReader;
  readonly tipsReader?: CurrentTipSessionsReader;
}): (scope: CommissionCoverageScope) => Promise<CommissionCoverageReport> {
  return (scope) =>
    runCommissionCoverageReport(
      {
        withTenant: dependencies.database.withTenant,
        lines: dependencies.lines,
        salaries: dependencies.salaries,
        sales: dependencies.sales,
        projection: createCoverageProjectionReader(),
        retained: dependencies.retained,
        companies: dependencies.companies,
        businesses: dependencies.businesses,
        consumerId: COMMISSION_INPUTS_CONSUMER_ID,
        handledTypes: new Set(COMMISSION_INPUT_EVENT_TYPES),
        ...(dependencies.tipsReader === undefined ? {} : { tipsReader: dependencies.tipsReader }),
      },
      scope,
    );
}
