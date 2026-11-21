import {
  packageSaleChanged,
  salaryChanged,
  serviceLineChanged,
  serviceSessionLinesAdded,
  serviceSessionRecorded,
  sessionTipsChanged,
  type PackageSaleChanged,
  type SalaryChanged,
  type ServiceLineChanged,
  type ServiceSessionLinesAdded,
  type ServiceSessionRecorded,
  type SessionTipsChanged,
} from '@pospay/contracts';
import type { ClaimedEvent } from '@pospay/db';

import {
  CommissionLineEventInvalidError,
  normalizeCommissionLineEvent,
  type ProjectServiceLines,
} from '../../use-cases/project-service-lines/project-service-lines.ts';
import {
  normalizePackageSaleEvent,
  type ProjectPackageSale,
} from '../../use-cases/project-package-sale/project-package-sale.ts';
import {
  normalizeSalaryEvent,
  type ProjectSalary,
} from '../../use-cases/project-salary/project-salary.ts';
import {
  normalizeSessionTipsEvent,
  type ProjectSessionTips,
} from '../../use-cases/project-session-tips/project-session-tips.ts';

type CommissionEventSchema =
  | typeof serviceSessionRecorded
  | typeof serviceSessionLinesAdded
  | typeof serviceLineChanged
  | typeof sessionTipsChanged
  | typeof salaryChanged
  | typeof packageSaleChanged;

type CommissionLineEventPayload =
  | ServiceSessionRecorded
  | ServiceSessionLinesAdded
  | ServiceLineChanged;

export interface CommissionInputUseCases {
  readonly lines: ProjectServiceLines;
  readonly tips: ProjectSessionTips;
  readonly salary: ProjectSalary;
  readonly sales: ProjectPackageSale;
}

const eventSchemas: Record<string, CommissionEventSchema | undefined> = {
  ServiceSessionRecorded: serviceSessionRecorded,
  ServiceSessionLinesAdded: serviceSessionLinesAdded,
  ServiceLineChanged: serviceLineChanged,
  SessionTipsChanged: sessionTipsChanged,
  SalaryChanged: salaryChanged,
  PackageSaleChanged: packageSaleChanged,
};

export async function onCommissionInputEvent(
  useCases: CommissionInputUseCases,
  event: ClaimedEvent,
): Promise<void> {
  const schema = eventSchemas[event.eventType];
  if (schema === undefined) throw new CommissionLineEventInvalidError('EVENT_TYPE');
  const parsed = schema.safeParse(event.payload);
  if (!parsed.success) throw new CommissionLineEventInvalidError('EVENT_SCHEMA');
  if (event.eventType === 'SessionTipsChanged') {
    await useCases.tips.execute(normalizeSessionTipsEvent(event, parsed.data as SessionTipsChanged));
    return;
  }
  if (event.eventType === 'SalaryChanged') {
    await useCases.salary.execute(normalizeSalaryEvent(event, parsed.data as SalaryChanged));
    return;
  }
  if (event.eventType === 'PackageSaleChanged') {
    await useCases.sales.execute(
      normalizePackageSaleEvent(event, parsed.data as PackageSaleChanged),
    );
    return;
  }
  await useCases.lines.execute(
    normalizeCommissionLineEvent(event, parsed.data as CommissionLineEventPayload),
  );
}
