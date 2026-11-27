import type { ClaimedEvent, DeliveryOutcome, TenantWrappers, Tx } from '@pospay/db';
import { ratingBusinessName, ratingNamesLabel, ratingTeamLabel } from '@pospay/i18n';
import { errorDiagnostic, type Logger } from '@pospay/observability';
import { RATING_CLAIMS_DISCOVERY } from '@pospay/contracts';
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
  closeQuietly,
  closeRedisClient,
  startRatingClaimsProcessor,
  throwCloseFailures,
} from './jobs/rating-claims.processor.ts';
import { branchScheduleHoursAdapter } from './persistence/branch-schedule-hours.adapter.ts';
import { businessNames } from './persistence/business-names.adapter.ts';
import { performerNameAdapter } from './persistence/performer-name.adapter.ts';
import { alertRules } from './persistence/alert-rule.adapter.ts';
import { lowRatingPlace } from './persistence/low-rating-place.adapter.ts';
import { teamContacts } from './persistence/team-contacts.adapter.ts';
import { lowRatingRecipients } from './persistence/low-rating-recipients.adapter.ts';
import {
  lowRatingOutbox,
  lowRatingRepository,
} from './persistence/low-rating-notice.repository.ts';
import { onLowRatingSubmitted } from './events/handlers/on-low-rating-submitted.handler.ts';
import { onNotificationDelivered } from './events/handlers/on-notification-delivered.handler.ts';
import { ratingSentRepository } from './persistence/rating-sent.repository.ts';
import { RecordRatingRequestSent } from './use-cases/record-rating-request-sent/record-rating-request-sent.ts';
import { RequestLowRatingNotice } from './use-cases/request-low-rating-notice/request-low-rating-notice.ts';
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
import { startCustomerImportProcessor } from './jobs/customer-import.processor.ts';
import { customerImportCommitTransactions } from './persistence/customer-import-commit.transactions.ts';
import {
  CommitCustomerImport,
  RecoverCustomerImports,
} from './use-cases/commit-customer-import/commit-customer-import.ts';
import type { CustomerImportCommitClock } from './ports/customer-import-commit.port.ts';

interface RatingScheduleDeps {
  ids: IdGenerator;
  clock: Clock;
  daySessions: DaySessionsPort;
  ratingSwitch?: RatingRequestsSwitchPort;
}

/**
 * مستهلك جرس التقييم المنخفض: يقرر ويركّب الإشعار ويلحق `LowRatingReceived` في معاملة التسليم نفسها.
 *
 * @param ids مولّد المعرفات لصف الدفتر وأحداث المجموعات
 * @param clock الساعة التي تحدد لحظة قرار الـ worker
 * @returns مستهلك الأوتبوكس لحدث `LowRatingSubmitted`
 */
export function createLowRatingNoticeConsumer(ids: IdGenerator, clock: Clock): OutboxConsumer {
  const bind = (tx: Tx) =>
    new RequestLowRatingNotice(
      {
        rules: alertRules(tx),
        recipients: lowRatingRecipients(tx),
        place: lowRatingPlace(tx),
        repository: lowRatingRepository(tx),
        outbox: lowRatingOutbox(tx),
        contacts: teamContacts(tx),
      },
      ids,
      clock,
    );
  return {
    id: 'customers.low-rating-notice-v1',
    eventTypes: ['LowRatingSubmitted'],
    handle: (tx, event) => onLowRatingSubmitted(bind(tx), event),
  };
}

/**
 * مستهلك قبول واتساب لطلب التقييم: يحوّل `NotificationDelivered` (SENT) لرسالة `rating_request` إلى انتقال الطلب SENDING إلى SENT (D-B8).
 * أي نتيجة لقالب أو قناة أو حالة غير ذلك تعدّي من غير أثر، والإعادة بلا أثر لأن الانتقال مشروط بحالة SENDING.
 *
 * @returns مستهلك الأوتبوكس لحدث `NotificationDelivered`
 */
export function createRatingSentConsumer(): OutboxConsumer {
  const useCase = new RecordRatingRequestSent<Tx>(ratingSentRepository);
  return {
    id: 'customers.rating-sent-v1',
    eventTypes: ['NotificationDelivered'],
    handle: (tx, event) => onNotificationDelivered(useCase, tx, event),
  };
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
  /**
   * وقت إعادة المحاولة بين تسجيلات الجدولة؛ بيتحقن عشان الاختبار يثبّت السلسلة
   * من غير ما يلمس سياسة `outbox`.
   */
  readonly retryDelayMs?: (attempt: number) => number | null;
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
  redis.on('error', (error: unknown) => {
    // فشل الاتصال عام على البنية كلها، فمفيش شركة تتنسب له.
    deps.logger.warn(
      { err: errorDiagnostic(error), component: 'state' },
      'rating claims queue error',
    );
  });
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
    ...(deps.retryDelayMs === undefined ? {} : { retryDelayMs: deps.retryDelayMs }),
  });
  return {
    deliver: (event, next) => processor.deliver(event, next),
    ready: () => processor.ready(),
    close: async () => {
      // العامل بيتصفّى الأول، وبعدين عميل الحالة؛ عميل الحالة اتعمل هنا، فبيتقفل هنا.
      // فشل واحد ما بيمنعش الباقي من القفل، وكل الأخطاء بتترمي في الآخر.
      const failures: unknown[] = [];
      await closeQuietly(failures, () => processor.close());
      await closeQuietly(failures, () => closeRedisClient(redis));
      throwCloseFailures(failures);
    },
    eventTypes: [...RATING_CLAIMS_TRIGGERS, RATING_CLAIMS_DISCOVERY],
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

/** يشغّل عامل تثبيت استيراد العملاء: يسلّم حدث الطلب إلى الطابور ويمسح الطلبات العالقة (073 D-4). */
export function startCustomersImportWorker(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
  options: { redisUrl: string; clock: CustomerImportCommitClock; prefix?: string },
) {
  const transactions = customerImportCommitTransactions(database, ids);
  const processor = startCustomerImportProcessor(
    new CommitCustomerImport(transactions, options.clock),
    new RecoverCustomerImports(transactions, options.clock),
    options.redisUrl,
    options.prefix,
  );
  return {
    eventTypes: ['CustomerImportCommitRequested'],
    deliver: (event: ClaimedEvent, next: (event: ClaimedEvent) => Promise<DeliveryOutcome>) =>
      event.eventType === 'CustomerImportCommitRequested' ? processor.deliver(event) : next(event),
    ready: processor.ready,
    close: processor.close,
  };
}
