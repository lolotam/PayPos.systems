import {
  serviceLineChanged,
  serviceSessionLinesAdded,
  serviceSessionRecorded,
  type ServiceLineChanged,
  type ServiceSessionLinesAdded,
  type ServiceSessionRecorded,
} from '@pospay/contracts';
import type { ClaimedEvent } from '@pospay/db';

import type { CommissionLineSnapshot } from '../../domain/commission-line-types.ts';
import { CommissionLineEventInvalidError } from '../../domain/errors.ts';
import type { ProjectServiceLines } from '../../use-cases/project-service-lines/project-service-lines.ts';

export async function onCommissionInputEvent(
  useCase: ProjectServiceLines,
  event: ClaimedEvent,
): Promise<void> {
  if (event.eventType === 'ServiceSessionRecorded' || event.eventType === 'ServiceSessionLinesAdded') {
    const schema = event.eventType === 'ServiceSessionRecorded'
      ? serviceSessionRecorded
      : serviceSessionLinesAdded;
    const parsed = schema.safeParse(event.payload);
    if (!parsed.success) throw new CommissionLineEventInvalidError('EVENT_SCHEMA');
    assertSessionAggregate(event, parsed.data.session_id);
    await useCase.execute(batchInput(event, parsed.data));
    return;
  }
  if (event.eventType === 'ServiceLineChanged') {
    const parsed = serviceLineChanged.safeParse(event.payload);
    if (!parsed.success) throw new CommissionLineEventInvalidError('EVENT_SCHEMA');
    assertSessionAggregate(event, parsed.data.session_id);
    await useCase.execute({
      companyId: event.companyId,
      businessId: parsed.data.business_id,
      lines: [normalizeLine(parsed.data)],
    });
    return;
  }
  throw new CommissionLineEventInvalidError('EVENT_TYPE');
}

function assertSessionAggregate(event: ClaimedEvent, sessionId: string): void {
  if (event.aggregateType !== 'service_session' || event.aggregateId !== sessionId) {
    throw new CommissionLineEventInvalidError('AGGREGATE_MISMATCH');
  }
}

function batchInput(
  event: ClaimedEvent,
  payload: ServiceSessionRecorded | ServiceSessionLinesAdded,
) {
  return {
    companyId: event.companyId,
    businessId: payload.business_id,
    lines: payload.lines.map((line) => normalizeLine(line)),
  };
}

function normalizeLine(line: ServiceLineChanged): CommissionLineSnapshot {
  return {
    lineId: line.line_id,
    sessionId: line.session_id,
    businessId: line.business_id,
    branchId: line.branch_id,
    serviceId: line.service_id,
    customerId: line.customer_id,
    status: line.status,
    occurredAt: line.occurred_at,
    recordedAt: line.recorded_at,
    businessDate: line.business_date,
    net: line.net,
    performers: line.performers.map((performer) => ({
      employeeId: performer.employee_id,
      shareBps: performer.share_bps,
    })),
    ruleSnapshot: line.rule_snapshot,
    countsSnapshot: line.counts_snapshot,
    revision: line.revision,
  };
}
