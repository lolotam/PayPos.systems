import type { TenantWrappers, Tx } from '@pospay/db';

import type { OutboxConsumer } from '../../outbox/consumer.ts';
import { onCommissionInputEvent } from './events/handlers/on-commission-input-event.handler.ts';
import {
  createCommissionLineProjectionScope,
  type BusinessTimeZoneReader,
} from './persistence/commission-line-projection.scope.ts';
import { commissionStatementExportTransactions } from './persistence/commission-statement-export.transactions.ts';
import {
  createCommissionSalaryProjectionScope,
  createCommissionTipProjectionScope,
  type BusinessCalendarReader,
  type EmployeeBusinessReader,
} from './persistence/commission-tip-salary-projection.scope.ts';
import type {
  Clock,
  IdGenerator,
} from './ports/commission-line-projection.port.ts';
import { ProjectSalary } from './use-cases/project-salary/project-salary.ts';
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

export interface CommissionInputsConsumerDependencies {
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly businessTimeZone: BusinessTimeZoneReader;
  readonly employeeBusiness: EmployeeBusinessReader;
  readonly businessCalendar: BusinessCalendarReader;
}

/** يربط مستهلك مدخلات العمولة بقارئ المنطقة الزمنية وبالساعة والمولّد المحقونين من الجذر. */
export function createCommissionInputsConsumer(
  dependencies: CommissionInputsConsumerDependencies,
): OutboxConsumer {
  const bind = (tx: Tx) => ({
    lines: new ProjectServiceLines(
      createCommissionLineProjectionScope(tx, dependencies.businessTimeZone),
      dependencies.clock,
      dependencies.ids,
    ),
    tips: new ProjectSessionTips(
      createCommissionTipProjectionScope(tx, dependencies.businessTimeZone, dependencies.ids),
      dependencies.clock,
      dependencies.ids,
    ),
    salary: new ProjectSalary(
      createCommissionSalaryProjectionScope(
        tx,
        dependencies.businessCalendar,
        dependencies.employeeBusiness,
      ),
      dependencies.clock,
      dependencies.ids,
    ),
  });
  return {
    id: 'commissions.project-inputs',
    eventTypes: [
      'ServiceSessionRecorded',
      'ServiceSessionLinesAdded',
      'ServiceLineChanged',
      'SessionTipsChanged',
      'SalaryChanged',
    ],
    handle: (tx, event) => onCommissionInputEvent(bind(tx), event),
  };
}
