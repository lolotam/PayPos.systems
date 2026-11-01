import {
  serviceLineChanged,
  serviceSessionLinesAdded,
  serviceSessionRecorded,
} from '@pospay/contracts';
import type { ClaimedEvent } from '@pospay/db';

import {
  CommissionLineEventInvalidError,
  normalizeCommissionLineEvent,
  type ProjectServiceLines,
} from '../../use-cases/project-service-lines/project-service-lines.ts';

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
    await useCase.execute(normalizeCommissionLineEvent(event, parsed.data));
    return;
  }
  if (event.eventType === 'ServiceLineChanged') {
    const parsed = serviceLineChanged.safeParse(event.payload);
    if (!parsed.success) throw new CommissionLineEventInvalidError('EVENT_SCHEMA');
    await useCase.execute(normalizeCommissionLineEvent(event, parsed.data));
    return;
  }
  throw new CommissionLineEventInvalidError('EVENT_TYPE');
}
