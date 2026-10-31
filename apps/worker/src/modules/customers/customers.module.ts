import type { ClaimedEvent, DeliveryOutcome, TenantWrappers } from '@pospay/db';
import { ratingNamesLabel, ratingTeamLabel } from '@pospay/i18n';
import type { OutboxConsumer } from '../../outbox/consumer.ts';
import { ratingClaimsDiscoveryConsumer } from './events/handlers/on-rating-claims-discovery.handler.ts';
import { onServiceSessionEvent } from './events/handlers/on-service-session-event.handler.ts';
import {
  runRatingBootstrap,
  type BootstrapDatabase,
  type BootstrapParams,
  type BootstrapResult,
} from './jobs/bootstrap-rating-requests.ts';
import {
  startRatingClaimsProcessor,
  type RatingClaimDetector,
} from './jobs/rating-claims.processor.ts';
import { branchScheduleHoursAdapter } from './persistence/branch-schedule-hours.adapter.ts';
import { businessNames } from './persistence/business-names.adapter.ts';
import { performerNameAdapter } from './persistence/performer-name.adapter.ts';
import { ratingClaimRepository } from './persistence/rating-claim.repository.ts';
import { ratingClaimTransactions } from './persistence/rating-claim.transactions.ts';
import { ratingOutbox } from './persistence/rating-outbox.adapter.ts';
import { ratingRequestRepository } from './persistence/rating-request.repository.ts';
import { ratingRequestsSwitch } from './persistence/rating-requests-switch.adapter.ts';
import { ratingTokenPort } from './persistence/rating-token.adapter.ts';
import type { Clock, IdGenerator } from './ports/clock.port.ts';
import type { DaySessionsPort } from './ports/day-sessions.port.ts';
import type { PerformerLabelPort } from './ports/performer-label.port.ts';
import type { RatingTokenDeriver } from './ports/rating-token.port.ts';
import type { RatingRequestsSwitchPort } from './ports/rating-requests-switch.port.ts';
import { ClaimRatingRequest } from './use-cases/claim-rating-request/claim-rating-request.ts';
import { ClaimRatingRequests } from './use-cases/claim-rating-requests/claim-rating-requests.ts';
import { ScheduleRatingRequest } from './use-cases/schedule-rating-request/schedule-rating-request.ts';

interface RatingScheduleDeps {
  ids: IdGenerator;
  clock: Clock;
  daySessions: DaySessionsPort;
  ratingSwitch?: RatingRequestsSwitchPort;
}

/**
 * رسم تسمية المنفذين من الكتالوج؛ الـ use case ما بيوصلش للكتالوج، والنص كله بيجي من
 * packages/i18n (CLAUDE.md §7)، فالدالة دي مربوطة هنا في جذر الموديل.
 */
export const performerLabelFormatter: PerformerLabelPort = {
  format: (choice, locale, businessName) =>
    choice.kind === 'TEAM'
      ? ratingTeamLabel(locale, businessName)
      : ratingNamesLabel(locale, choice.names),
};

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

/** مدخلات مشغّل مطالبة طلبات التقييم: الجدولة لكل شركة والمطالبة نفسها. */
export interface RatingClaimsWorkerDeps {
  database: Pick<TenantWrappers, 'withTenant'>;
  ids: IdGenerator;
  clock: Clock;
  daySessions: DaySessionsPort;
  redisUrl: string;
  prefix?: string;
  /** كود اشتقاق البصمة من جذر الـ worker، أو null لما القدرة غير جاهزة. */
  deriver: RatingTokenDeriver | null;
}

/** مشغّل مطالبة طلبات التقييم: يسجّل جدولة كل شركة ويطالب بطلباتها المستحقة. */
export interface RatingClaimsWorker {
  eventTypes: readonly string[];
  deliver(event: ClaimedEvent, next: (event: ClaimedEvent) => Promise<DeliveryOutcome>): Promise<DeliveryOutcome>;
  ready(): Promise<void>;
  close(): Promise<void>;
  consumer: OutboxConsumer;
}

/**
 * يشغّل مطالبة طلبات التقييم: الجدولة لكل شركة بتتسجل مع أول حدث جدولة، والمهمة بتطالب
 * بالطلبات المستحقة بمعاملة لكل طلب.
 */
export function startRatingClaimsWorker(deps: RatingClaimsWorkerDeps): RatingClaimsWorker {
  const claim = new ClaimRatingRequest(
    {
      switch: ratingRequestsSwitch,
      hours: branchScheduleHoursAdapter,
      names: businessNames,
      daySessions: deps.daySessions,
      performers: performerNameAdapter,
      label: performerLabelFormatter,
      claims: ratingClaimRepository,
      token: ratingTokenPort(deps.deriver),
      outbox: ratingOutbox,
    },
    deps.ids,
    deps.clock,
  );
  const detector: RatingClaimDetector = new ClaimRatingRequests(
    ratingClaimTransactions(deps.database),
    claim,
    deps.clock,
  );
  const processor = startRatingClaimsProcessor(detector, deps.redisUrl, deps.prefix);
  const consumer = ratingClaimsDiscoveryConsumer();
  return {
    eventTypes: consumer.eventTypes,
    deliver: processor.deliver,
    ready: processor.ready,
    close: processor.close,
    consumer,
  };
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
