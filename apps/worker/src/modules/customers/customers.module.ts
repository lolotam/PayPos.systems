import type { OutboxConsumer } from '../../outbox/consumer.ts';
import { onServiceSessionEvent } from './events/handlers/on-service-session-event.handler.ts';
import {
  runRatingBootstrap,
  type BootstrapDatabase,
  type BootstrapParams,
  type BootstrapResult,
} from './jobs/bootstrap-rating-requests.ts';
import { branchScheduleHoursAdapter } from './persistence/branch-schedule-hours.adapter.ts';
import { ratingRequestRepository } from './persistence/rating-request.repository.ts';
import { ratingRequestsSwitch } from './persistence/rating-requests-switch.adapter.ts';
import type { Clock, IdGenerator } from './ports/clock.port.ts';
import type { DaySessionsPort } from './ports/day-sessions.port.ts';
import type { RatingRequestsSwitchPort } from './ports/rating-requests-switch.port.ts';
import { ScheduleRatingRequest } from './use-cases/schedule-rating-request/schedule-rating-request.ts';

interface RatingScheduleDeps {
  ids: IdGenerator;
  clock: Clock;
  daySessions: DaySessionsPort;
  ratingSwitch?: RatingRequestsSwitchPort;
}

export function createRatingSchedulingConsumer(deps: RatingScheduleDeps): OutboxConsumer {
  const useCase = buildScheduleUseCase(deps);
  return {
    id: 'customers.rating-scheduling-v1',
    eventTypes: ['ServiceSessionRecorded', 'ServiceSessionLinesAdded', 'ServiceLineChanged'],
    handle: (tx, event) => onServiceSessionEvent(useCase, tx, event),
  };
}

/**
 * يبني مشغّل الـ bootstrap: نفس حالة الجدولة اللي بيشتغل بها المستهلك الحي، فكل زيارة بتعدّي
 * على نفس المسار بالظبط.
 */
export function createRatingBootstrap(
  deps: RatingScheduleDeps & {
    db: BootstrapDatabase;
    log(line: string): void;
  },
): (params: BootstrapParams) => Promise<BootstrapResult> {
  const useCase = buildScheduleUseCase(deps);
  return (params) =>
    runRatingBootstrap(
      {
        db: deps.db,
        daySessions: deps.daySessions,
        schedule: useCase,
        clock: deps.clock,
        log: deps.log,
      },
      params,
    );
}

// منافذ حالة الجدولة بتتربط في مكان واحد، فالمستهلك الحي والـ bootstrap بيبانوا زي بعض.
function buildScheduleUseCase(deps: RatingScheduleDeps): ScheduleRatingRequest {
  return new ScheduleRatingRequest(
    {
      switch: deps.ratingSwitch ?? ratingRequestsSwitch,
      hours: branchScheduleHoursAdapter,
      daySessions: deps.daySessions,
      requests: ratingRequestRepository,
    },
    deps.ids,
    deps.clock,
  );
}
