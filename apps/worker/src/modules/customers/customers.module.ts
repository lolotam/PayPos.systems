import type { ClaimedEvent, DeliveryOutcome, TenantWrappers, Tx } from '@pospay/db';
import { ratingBusinessName, ratingNamesLabel, ratingTeamLabel } from '@pospay/i18n';
import type { Logger } from '@pospay/observability';
import { Redis } from 'ioredis';
import type { OutboxConsumer } from '../../outbox/consumer.ts';
import { onServiceSessionEvent } from './events/handlers/on-service-session-event.handler.ts';
import {
  runRatingBootstrap,
  type BootstrapDatabase,
  type BootstrapParams,
  type BootstrapResult,
} from './jobs/bootstrap-rating-requests.ts';
import {
  RATING_CLAIMS_TRIGGERS,
  closeRedisClient,
  startRatingClaimsProcessor,
} from './jobs/rating-claims.processor.ts';
import { branchScheduleHoursAdapter } from './persistence/branch-schedule-hours.adapter.ts';
import { businessNames } from './persistence/business-names.adapter.ts';
import { performerNameAdapter } from './persistence/performer-name.adapter.ts';
import { ratingClaimDiagnostics } from './persistence/rating-claim-diagnostics.ts';
import { ratingClaimRepository } from './persistence/rating-claim.repository.ts';
import { ratingClaimTransactions } from './persistence/rating-claim.transactions.ts';
import { redisRatingClaimState } from './persistence/redis-rating-claim-state.ts';
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
  businessName: ratingBusinessName,
};

export function createRatingSchedulingConsumer(deps: RatingScheduleDeps): OutboxConsumer {
  const useCase = buildScheduleUseCase(deps);
  return {
    id: 'customers.rating-scheduling-v1',
    eventTypes: RATING_CLAIMS_TRIGGERS,
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

/** مدخلات مطالبة الطلب الواحد: نفس المنافذ اللي بتتربط في جذر الـ worker. */
export interface RatingClaimDeps {
  ids: IdGenerator;
  clock: Clock;
  daySessions: DaySessionsPort<Tx>;
  /** كود اشتقاق البصمة من جذر الـ worker، أو null لما القدرة غير جاهزة. */
  deriver: RatingTokenDeriver | null;
}

/**
 * يبني مطالبة الطلب الواحد بكل منافذها مربوطة.
 * السلايس 59b-2a بينزّل النواة ساكتة: مفيش متصل تشغيل، ولا طابور، ولا جدولة، ومفيش
 * migration؛ السلايس الجاية (59b-2b/59b-2c) هي اللي هتندادي المصنع ده.
 *
 * @param deps المولّد والساعة وقارئ اليوم وكود اشتقاق البصمة
 * @returns use case المطالبة على طلب واحد
 */
export function createClaimRatingRequest(deps: RatingClaimDeps): ClaimRatingRequest<Tx> {
  return new ClaimRatingRequest<Tx>(
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

/** دورة حياة مجدول طلبات التقييم: التسليم، والجهوزية، والإغلاق، وأحداثه. */
export interface RatingClaimsLifecycle {
  /**
   * يوجّه الحدث للمجدول ويمرّره بعد كده.
   *
   * @param event الحدث المسلّم من المرسِل
   * @param next المسلّم التالي للأحداث التانية
   * @returns نتيجة التسليم
   */
  deliver(
    event: ClaimedEvent,
    next: (event: ClaimedEvent) => Promise<DeliveryOutcome>,
  ): Promise<DeliveryOutcome>;

  /**
   * ينتظر جهوزية المجدول.
   *
   * @returns لا شيء
   */
  ready(): Promise<void>;

  /**
   * يقفل المجدول ويصفّي الموارد.
   *
   * @returns لا شيء
   */
  close(): Promise<void>;

  /** أحداث المجدول اللي بيحتاجها، فالمجدول الميت ما بيعلنش عن حاجة. */
  readonly eventTypes: readonly string[];
}

/** مدخلات المصنع الحيّ: منافذ المطالبة، وداتابيز المستأجر، واتصال Redis. */
export interface RatingClaimsRuntimeDeps extends RatingClaimDeps {
  /** داتابيز المستأجر لقراءة حدود الجولة وطلبها. */
  readonly database: Pick<TenantWrappers, 'withTenant'>;
  /** رابط Redis للحالة والطابور. */
  readonly redisUrl: string;
  /** بادئة مفاتيح حالة الجدولة؛ بتتحقق من جذر الموديل. */
  readonly statePrefix: string;
  /** بادئة مفاتيح BullMQ للطابور. */
  readonly queuePrefix?: string;
  /** سجل العامل. */
  readonly logger: Logger;
}

/**
 * مهلة أمر Redis في حالة الجدولة: اتصال نصف مفتوح كان هيعليق الدور للأبد، ومن غير
 * حدّ زمني كل الشركات على العامل بتتوقف. نفس مهلة منتج الطابور المجاور؛ والمهلة
 * بتيجي على مسار ضياع الرد، والسور بيخلي المسار ده آمن.
 */
const STATE_COMMAND_TIMEOUT_MS = 5_000;

/**
 * يبني المجدول الحيّ: حالة الجدولة في Redis، ودور الخدمة، ومعالج الطابور.
 *
 * المصنع ده مش بيتنادى من الإقلاع (تصميم 7)، والتركيب الفعلي بيسجّل دورة الحياة
 * المغلقة بس. منفذ حالة Redis بيتربط هنا في جذر الموديل وبس، ومش في أي مكان تاني.
 *
 * @param deps منافذ المطالبة وداتابيز المستأجر ورابط Redis والبادئة والسجل
 * @returns دورة حياة المجدول الحيّ
 */
export function createRatingClaimsRuntime(deps: RatingClaimsRuntimeDeps): RatingClaimsLifecycle {
  const redis = new Redis(deps.redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    commandTimeout: STATE_COMMAND_TIMEOUT_MS,
    // اسم الاتصال بيميّز عميل الحالة عن عملاء BullMQ في قائمة اتصالات Redis.
    connectionName: 'pospay-rating-claims-state',
  });
  redis.on('error', () => undefined);
  const state = redisRatingClaimState({ prefix: deps.statePrefix, redis });
  const turn = new ClaimRatingRequests<Tx>(
    {
      state,
      transactions: ratingClaimTransactions(deps.database),
      requests: ratingClaimRepository,
      claim: createClaimRatingRequest(deps),
      diagnostics: ratingClaimDiagnostics(deps.logger),
    },
    deps.ids,
    deps.clock,
  );
  const processor = startRatingClaimsProcessor({
    redisUrl: deps.redisUrl,
    turn,
    logger: deps.logger,
    ...(deps.queuePrefix === undefined ? {} : { prefix: deps.queuePrefix }),
  });
  return {
    deliver: (event, next) => processor.deliver(event, next),
    ready: () => processor.ready(),
    close: async () => {
      // العامل بيتصفّى الأول، وبعدين عميل الحالة؛ عميل الحالة اتعمل هنا، فبيتقفل هنا.
      await processor.close();
      await closeRedisClient(redis);
    },
    eventTypes: RATING_CLAIMS_TRIGGERS,
  };
}

/**
 * دورة حياة مغلقة لمجدول طلبات التقييم: من غير طابور ومن غير عامل ومن دون حالة Redis.
 *
 * التصميم 7: المجدول الحيّ مش بيشتغل من الإقلاع، فالتركيب الفعلي بيسجّل المسجّل
 * المغلق ده وخلاص. المسجّل بيعدّي كل حدث زي ما هو.
 *
 * @returns دورة حياة مغلقة ما بتفتحش أي مورد
 */
export function closedRatingClaimsLifecycle(): RatingClaimsLifecycle {
  return {
    deliver: (event, next) => next(event),
    ready: async () => undefined,
    close: async () => undefined,
    eventTypes: [],
  };
}
