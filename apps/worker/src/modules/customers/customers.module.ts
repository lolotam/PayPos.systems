import type { OutboxConsumer } from '../../outbox/consumer.ts';
import { onServiceSessionEvent } from './events/handlers/on-service-session-event.handler.ts';
import { branchScheduleHoursAdapter } from './persistence/branch-schedule-hours.adapter.ts';
import { ratingRequestRepository } from './persistence/rating-request.repository.ts';
import { ratingRequestsSwitch } from './persistence/rating-requests-switch.adapter.ts';
import type { Clock, IdGenerator } from './ports/clock.port.ts';
import type { DaySessionsPort } from './ports/day-sessions.port.ts';
import type { RatingRequestsSwitchPort } from './ports/rating-requests-switch.port.ts';
import { ScheduleRatingRequest } from './use-cases/schedule-rating-request/schedule-rating-request.ts';

export function createRatingSchedulingConsumer(deps: {
  ids: IdGenerator;
  clock: Clock;
  daySessions: Pick<DaySessionsPort, 'activeLines'>;
  ratingSwitch?: RatingRequestsSwitchPort;
}): OutboxConsumer {
  const useCase = new ScheduleRatingRequest(
    {
      switch: deps.ratingSwitch ?? ratingRequestsSwitch,
      hours: branchScheduleHoursAdapter,
      daySessions: deps.daySessions,
      requests: ratingRequestRepository,
    },
    deps.ids,
    deps.clock,
  );
  return {
    id: 'customers.rating-scheduling-v1',
    eventTypes: ['ServiceSessionRecorded', 'ServiceSessionLinesAdded', 'ServiceLineChanged'],
    handle: (tx, event) => onServiceSessionEvent(useCase, tx, event),
  };
}
