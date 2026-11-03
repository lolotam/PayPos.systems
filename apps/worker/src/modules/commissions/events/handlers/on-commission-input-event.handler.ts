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

type CommissionEventSchema =
  | typeof serviceSessionRecorded
  | typeof serviceSessionLinesAdded
  | typeof serviceLineChanged;

const eventSchemas: Record<string, CommissionEventSchema | undefined> = {
  ServiceSessionRecorded: serviceSessionRecorded,
  ServiceSessionLinesAdded: serviceSessionLinesAdded,
  ServiceLineChanged: serviceLineChanged,
};

export async function onCommissionInputEvent(
  useCase: ProjectServiceLines,
  event: ClaimedEvent,
): Promise<void> {
  const schema = eventSchemas[event.eventType];
  if (schema === undefined) throw new CommissionLineEventInvalidError('EVENT_TYPE');
  const parsed = schema.safeParse(event.payload);
  if (!parsed.success) throw new CommissionLineEventInvalidError('EVENT_SCHEMA');
  await useCase.execute(normalizeCommissionLineEvent(event, parsed.data));
}
