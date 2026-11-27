import { systemUuidV7 } from '@pospay/ids';
import type { Logger } from '@pospay/observability';
import { Redis } from 'ioredis';
import type {
  ClaimedEvent,
  DeliveryOutcome,
  OutboxDispatcherDatabase,
  TenantWrappers,
} from '@pospay/db';

import {
  checkCommissionReminderReadiness,
  createCommissionReminderCoverageSweeper,
  createCommissionReminderDelivery,
  createCommissionReminderSchedule,
  createReminderRecoveryStore,
  createStatementReminderTransactions,
  recoverCommissionReminders,
  REMINDER_COVERAGE_SWEEP_INTERVAL_MS,
  remindCommissionStatements,
  reminderRecoveryReaders,
  startCommissionReminderWorker,
  type CommissionReminderSchedule,
  type RecoverCommissionRemindersDeps,
  type ReminderRecoveryReaders,
  type RecoveryResult,
  type VerifyCommissionReminderCoverageDeps,
  type ReminderRecoveryStore,
} from './modules/commissions/index.ts';
import { statementReminderAlertRules } from './modules/commissions/persistence/alert-rule.adapter.ts';
import {
  commissionStatementRecipients,
  readExplicitCompanyFeature,
} from './modules/identity/index.ts';
import { companyBusinesses, companyFeatureEnabled } from './modules/tenancy/index.ts';

/** المدة بين محاولات مسار البداية بعد فشله أو رفضه بالإيقاع: نفس نبض الفحص الدوري. */
const STARTUP_RETRY_MS = 60_000;

/** خيارات تكرار مسار البداية: إشارة الإيقاف والمدة بين المحاولات. */
export interface StartupRecoveryOptions {
  readonly signal: AbortSignal;
  readonly retryMs: number;
}

/**
 * يكرّر مسار البداية بالسبب `STARTUP` لحد ما يتنشر شهادة (ADR-0061 §4 الخطوة 2): بداية
 * فشلت أو اترفضت بالإيقاع أو لقيت مسارًا تانيًا شغّال ما بتخرجش أبدًا بـ«مفيش حاجة مطلوبة»،
 * لأن سبب البداية بيفضل لحد النشر. الإيقاع المشترك هو اللي بيمنع تكرار الفتحة.
 *
 * @param run     تشغيل مسار بداية واحد
 * @param options إشارة الإيقاف والمدة بين المحاولات
 * @returns نتيجة المسار اللي نشر، أو null لو اتوقف قبل النشر
 */
export async function runStartupRecovery(
  run: () => Promise<RecoveryResult>,
  options: StartupRecoveryOptions,
): Promise<RecoveryResult | null> {
  while (!options.signal.aborted) {
    const result = await run().catch(() => null);
    if (result?.outcome === 'PUBLISHED') return result;
    await waitOrAbort(options.retryMs, options.signal);
  }
  return null;
}

/**
 * ينتظر مدة أو لحد الإيقاف، أيهما أول.
 *
 * @param ms     المدة بالميلي ثانية
 * @param signal إشارة الإيقاف
 * @returns وعد بيتحقق عند انتهاء المدة أو الإيقاف
 */
function waitOrAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** دالة التسليم في مسار العامل: الحدث المسلّم والخطوة التالية. */
type Deliver = (event: ClaimedEvent) => Promise<DeliveryOutcome>;

/** كل ما مسار التذكيرات والاستعادة محتاجه من الجذر. */
export interface CommissionReminderWiringOptions {
  readonly app: Pick<TenantWrappers, 'withTenant'>;
  readonly dispatcher: OutboxDispatcherDatabase;
  readonly redisUrl: string;
  readonly logger: Logger;
}

/** مسار التذكيرات والاستعادة مربوط في الجذر: الجدولة، والتسليم، والعامل، والفحص. */
export interface CommissionReminderWiring {
  /** معالج التسليم: يسجّل الجدولة قبل علامة الاستهلاك. */
  readonly delivery: (event: ClaimedEvent, next: Deliver) => Promise<DeliveryOutcome>;
  /** فحص الجاهزية: نفس شروط الاستعادة بالظبط. */
  readonly readiness: () => Promise<void>;
  /** يوقف نبض الفحص الدوري. */
  readonly stop: () => void;
  /** يقفل العامل والجدولة واتصال الاستعادة. */
  readonly close: () => Promise<void>;
}

/**
 * يربط مسار تذكيرات كشف العمولة (FR-053) واستعادة جدولتها (ADR-0061) في الجذر: الجدولة
 * على Redis، والتسجيل قبل علامة الاستهلاك، ونبض الفحص، وفحص الجاهزية.
 *
 * @param options قاعدة البيانات والمرسّل وعنوان Redis
 * @returns المسار المربوط
 */
export function startCommissionReminderWiring(
  options: CommissionReminderWiringOptions,
): CommissionReminderWiring {
  const logger = options.logger;
  const schedule = createCommissionReminderSchedule({ redisUrl: options.redisUrl, logger });
  const delivery = createCommissionReminderDelivery<ClaimedEvent, DeliveryOutcome>(
    schedule,
    logger,
  );
  const recoveryRedis = new Redis(options.redisUrl, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  recoveryRedis.on('error', (error: unknown) =>
    logger.warn({ err: error }, 'redis connection error'),
  );
  const store = createReminderRecoveryStore(recoveryRedis);
  const database = reminderRecoveryReaders(options.dispatcher);
  const recoveryDeps = recoveryDependencies(options, store, schedule, database, logger);
  const transactions = createStatementReminderTransactions(options.app, systemUuidV7(), {
    businesses: companyBusinesses,
    feature: (tx, id) => companyFeatureEnabled(tx, id, 'commissions'),
    recipients: commissionStatementRecipients,
    alertRules: statementReminderAlertRules,
    switch: readExplicitCompanyFeature,
  });
  const worker = startCommissionReminderWorker(options.redisUrl, (companyId) =>
    remindCommissionStatements({ transactions, clock: { now: () => new Date() } }, companyId),
  );
  const heartbeat = setInterval(() => {
    void recoverCommissionReminders(recoveryDeps, { mode: 'DETECT' }).catch(() => undefined);
  }, 60_000);
  heartbeat.unref?.();
  const coverage = startCoverageSweep({ database, store, schedule, logger });
  const startup = new AbortController();
  void runStartupRecovery(() => recoverCommissionReminders(recoveryDeps, { mode: 'STARTUP' }), {
    signal: startup.signal,
    retryMs: STARTUP_RETRY_MS,
  });
  return {
    delivery: (event, next) => delivery(event, next),
    readiness: async () => {
      const result = await checkCommissionReminderReadiness({ database, store, schedule });
      if (!result.ready) throw new Error(`COMMISSION_REMINDER_RECOVERY_${result.reason}`);
    },
    stop: () => {
      clearInterval(heartbeat);
      coverage.stop();
      startup.abort();
    },
    close: async () => {
      clearInterval(heartbeat);
      coverage.stop();
      startup.abort();
      await coverage.drain();
      await Promise.allSettled([worker.close(), schedule.close(), recoveryRedis.quit()]);
      recoveryRedis.disconnect();
    },
  };
}

/** مقبض الفحص الدوري: إيقاف المؤقّت، وانتظار جولة شغّالة قبل إغلاق Redis. */
interface CoverageSweepHandle {
  readonly stop: () => void;
  readonly drain: () => Promise<void>;
}

/**
 * يشغّل الفحص الدوري لتغطية الجدولات (ADR-0061 §8): مؤقّت مستقل عن نبض الاستعادة، وحارس
 * التداخل جوه المشغّل. الجولة الشغّالة بيتحتفظ بوعدها، عشان `close` تستناها قبل ما اتصال Redis
 * يتقفل فما تفشلش بـ`REDIS_ENDED` بعد الإغلاق.
 *
 * @param deps القارئات والجدولة والسجل
 * @returns مقبض الإيقاف والانتظار
 */
function startCoverageSweep(
  deps: Omit<VerifyCommissionReminderCoverageDeps, 'clock'>,
): CoverageSweepHandle {
  const sweeper = createCommissionReminderCoverageSweeper({
    ...deps,
    clock: { now: () => new Date() },
  });
  let inFlight: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (inFlight !== null) return;
    const run: Promise<void> = sweeper
      .run()
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        if (inFlight === run) inFlight = null;
      });
    inFlight = run;
  }, REMINDER_COVERAGE_SWEEP_INTERVAL_MS);
  timer.unref?.();
  return {
    stop: () => clearInterval(timer),
    drain: async () => {
      await inFlight;
    },
  };
}

/**
 * يبني اعتماديات المسار: قارئ المرسّل ومتجر Redis والجدولة والساعة والمولّد.
 *
 * @param options  قاعدة البيانات والمرسّل وعنوان Redis والسجل
 * @param store    متجر الاستعادة على Redis
 * @param schedule جدولة التذكيرات
 * @param database قارئ الاستعادة
 * @param logger   السجل
 * @returns اعتماديات المسار
 */
function recoveryDependencies(
  options: CommissionReminderWiringOptions,
  store: ReminderRecoveryStore,
  schedule: CommissionReminderSchedule,
  database: ReminderRecoveryReaders,
  logger: Logger,
): RecoverCommissionRemindersDeps {
  return {
    database,
    store,
    schedule,
    ids: systemUuidV7(),
    clock: { now: () => new Date() },
    logger,
    release: 'worker',
    clearIncident: (input) =>
      options.dispatcher.clearReminderSchedulesLostFlag({
        flagId: input.incidentId,
        rebuiltRunId: input.runId,
        rebuiltPassId: input.passId,
        companiesRebuilt: input.companiesRebuilt,
        auditId: input.auditId,
      }),
  };
}
