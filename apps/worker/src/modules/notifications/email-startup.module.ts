import {
  createPlatformEmailDatabase,
  type PlatformEmailDatabase,
  type TenantWrappers,
} from '@pospay/db';
import {
  createEmailIdentity,
  createResendEmailRetriever,
  EMAIL_FEEDBACK_QUEUE,
  emailFeedbackJob,
  notificationRedisOptions,
  readEmailConfiguration,
  type EmailDisabledReason,
} from '@pospay/notifications';
import type { Logger } from '@pospay/observability';
import { Worker, type Queue } from 'bullmq';
import { sql } from 'drizzle-orm';

import { closeOptional, optionalWithin } from '../../shared/optional-capability.ts';
import { createEmailModule } from './email.module.ts';
import { emailFeedbackProcessor } from './jobs/email-feedback.processor.ts';
import { emailMaintenanceProcessor } from './jobs/email-maintenance.processor.ts';
import { notificationQueue } from './jobs/notification-queue.ts';
import type { Clock } from './ports/clock.port.ts';
import type { IdGenerator } from './ports/id-generator.port.ts';
import {
  createEmailFeedbackInboxRepository,
  createEmailFeedbackTenantRepository,
} from './persistence/drizzle-email-feedback-inbox.repository.ts';
import { ClearEmailFeedbackPayloads } from './use-cases/clear-email-feedback-payloads/clear-email-feedback-payloads.ts';
import { ReconcileEmailFeedback } from './use-cases/reconcile-email-feedback/reconcile-email-feedback.ts';
import { RecoverEmailFeedback } from './use-cases/recover-email-feedback/recover-email-feedback.ts';

const MAINTENANCE_QUEUE = 'notifications-email-feedback-maintenance';
const RECOVER_JOB = 'recover-email-feedback';
const CLEAR_JOB = 'clear-email-payloads';

export type EmailModule = ReturnType<typeof createEmailModule>;

export interface EmailStartupOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly production: boolean;
  readonly logger: Logger;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly appDatabase?: Pick<TenantWrappers, 'withTenant'>;
  readonly redisUrl?: string;
}

/** تهيئة قناة البريد: الموديول وموارد ردّ المزود وعدد الصفوف المعطّلة. */
export interface EmailActivation {
  readonly module: EmailModule;
  readonly stop?: () => Promise<void>;
  readonly close: () => Promise<void>;
  readonly quarantinedCount: number;
}

interface EmailCapabilityState {
  module: EmailModule;
  reason: EmailDisabledReason | null;
  status: 'DISABLED' | 'UNAVAILABLE' | 'READY';
  closed: boolean;
}

/** يشغّل قناة البريد ومصالحة ردّ المزود؛ أي تعثّر يقفلها عند CONFIG_INVALID بدون أثر على readiness. */
export async function startEmailCapability(
  options: EmailStartupOptions,
  activate: () => Promise<EmailActivation> = () => activateEmail(options),
) {
  const fallback = createEmailModule({
    production: options.production,
    clock: options.clock,
    ids: options.ids,
    configuration: readEmailConfiguration(options.env, { feedbackReady: false }),
  });
  const attempt = Promise.resolve().then(activate);
  const activation = await optionalWithin(() => attempt).catch(() => undefined);
  if (activation === undefined) void attempt.then((late) => late.close()).catch(() => undefined);
  const state: EmailCapabilityState = {
    module: activation?.module ?? fallback,
    reason:
      activation === undefined ? 'EMAIL_FEEDBACK_UNAVAILABLE' : activation.module.capability.reason,
    status:
      activation === undefined
        ? 'UNAVAILABLE'
        : activation.module.capability.enabled
          ? 'READY'
          : 'DISABLED',
    closed: false,
  };
  options.logger.info(capabilityLog(state, activation?.quarantinedCount ?? 0), 'email capability');
  const stop = async () => {
    state.closed = true;
    state.module = fallback;
    state.reason = fallback.capability.reason;
    state.status = 'DISABLED';
    await closeOptional([() => activation?.stop?.()]);
  };
  return {
    module: capabilityView(state),
    stop,
    close: async () => {
      await stop();
      await closeOptional([() => activation?.close()]);
    },
  };
}

/** سجل القدرة: القناة والحالة والسبب وعدد الصفوف المعطّلة. */
function capabilityLog(state: EmailCapabilityState, quarantinedCount: number) {
  return {
    capability: {
      channel: 'email',
      enabled: state.module.capability.enabled,
      reason: state.reason,
      name: 'EMAIL',
      state: state.status,
      quarantinedCount,
    },
  };
}

/** واجهة القدرة: بتقرأ الحالة وقت كل نداء عشان القفل يبقى فوري. */
function capabilityView(state: EmailCapabilityState) {
  return {
    get capability() {
      return { enabled: state.module.capability.enabled, reason: state.reason };
    },
    get adapter() {
      return state.module.adapter;
    },
    matches: (...args: Parameters<EmailModule['matches']>) =>
      !state.closed && state.module.matches(...args),
    authorize: async (...args: Parameters<EmailModule['authorize']>) => {
      if (state.closed) throw new Error('EMAIL_CAPABILITY_CLOSED');
      await state.module.authorize(...args);
    },
  };
}

async function activateEmail(options: EmailStartupOptions): Promise<EmailActivation> {
  const feedback = await startFeedback(options);
  const module = createEmailModule({
    production: options.production,
    clock: options.clock,
    ids: options.ids,
    configuration: readEmailConfiguration(options.env, { feedbackReady: feedback.ready }),
  });
  return {
    module,
    stop: feedback.stop,
    close: feedback.close,
    quarantinedCount: feedback.quarantinedCount,
  };
}

interface EmailFeedback {
  readonly ready: boolean;
  readonly quarantinedCount: number;
  readonly stop: () => Promise<void>;
  readonly close: () => Promise<void>;
}

async function startFeedback(options: EmailStartupOptions): Promise<EmailFeedback> {
  const url = options.env['PLATFORM_NOTIFICATIONS_DATABASE_URL'] ?? '';
  if (!/^postgres(ql)?:\/\//i.test(url))
    return {
      ready: false,
      quarantinedCount: 0,
      stop: async () => undefined,
      close: async () => undefined,
    };
  const redisUrl = options.redisUrl ?? options.env['REDIS_URL'] ?? '';
  const appDatabase = options.appDatabase;
  const keys = feedbackKeys(options.env);
  if (redisUrl === '' || appDatabase === undefined)
    throw new Error('EMAIL_FEEDBACK_DEPENDENCIES_MISSING');
  if (keys === null)
    return {
      ready: false,
      quarantinedCount: 0,
      stop: async () => undefined,
      close: async () => undefined,
    };
  const runtime = openFeedbackRuntime(options, url, redisUrl, appDatabase, keys);
  try {
    const quarantinedCount = await optionalWithin(() => runtime.ready());
    return {
      ready: true,
      quarantinedCount,
      stop: () => runtime.stop(),
      close: () => runtime.close(),
    };
  } catch (error) {
    await runtime.close(true);
    throw error;
  }
}

interface FeedbackRuntime {
  ready(): Promise<number>;
  stop(): Promise<void>;
  close(force?: boolean): Promise<void>;
}

function openFeedbackRuntime(
  options: EmailStartupOptions,
  url: string,
  redisUrl: string,
  appDatabase: Pick<TenantWrappers, 'withTenant'>,
  keys: NonNullable<ReturnType<typeof feedbackKeys>>,
): FeedbackRuntime {
  const database = createPlatformEmailDatabase({ url });
  const connection = notificationRedisOptions(redisUrl);
  const error = () => options.logger.warn({}, 'email feedback queue error');
  const resource = notificationQueue(EMAIL_FEEDBACK_QUEUE, connection, error);
  const maintenanceResource = notificationQueue(MAINTENANCE_QUEUE, connection, error);
  const inbox = createEmailFeedbackInboxRepository(database);
  const worker = new Worker(
    EMAIL_FEEDBACK_QUEUE,
    emailFeedbackProcessor(reconcile(options, inbox, appDatabase, keys)),
    { connection, concurrency: 4 },
  );
  const maintenanceWorker = new Worker(
    MAINTENANCE_QUEUE,
    emailMaintenanceProcessor(
      recover(options, inbox, resource.queue),
      new ClearEmailFeedbackPayloads(inbox, options.clock),
    ),
    { connection, concurrency: 1 },
  );
  const logError = (failure: unknown) =>
    options.logger.warn({ err: failure }, 'email feedback job failed');
  resource.queue.on('error', logError);
  worker.on('error', logError);
  worker.on('failed', (job, failure) =>
    options.logger.warn({ event: { id: job?.id }, err: failure }, 'email feedback job failed'),
  );
  return {
    ready: async () => {
      await database.ping();
      const quarantinedCount = await countQuarantined(database);
      await Promise.all([
        resource.queue.waitUntilReady(),
        worker.waitUntilReady(),
        maintenanceResource.queue.waitUntilReady(),
        maintenanceWorker.waitUntilReady(),
      ]);
      await scheduleMaintenance(maintenanceResource.queue);
      return quarantinedCount;
    },
    stop: async () => {
      await Promise.allSettled([worker.close(), maintenanceWorker.close()]);
    },
    close: async (force = false) => {
      await Promise.allSettled([
        worker.close(force),
        maintenanceWorker.close(force),
        resource.close(force),
        maintenanceResource.close(force),
        database.close(force),
      ]);
    },
  };
}

function feedbackKeys(env: NodeJS.ProcessEnv) {
  const apiKey = env['RESEND_API_KEY'] ?? '';
  if (apiKey === '' || /[\r\n]/.test(apiKey)) return null;
  try {
    const identity = createEmailIdentity(
      env['NOTIFICATION_EMAIL_HASH_KEY'] ?? '',
      env['NOTIFICATION_EMAIL_HASH_KEY_ID'] ?? '',
    );
    return {
      apiKey,
      identify: (canonical: string) => {
        const computed = identity.identify(canonical);
        return { hash: computed.hash, keyId: computed.hashKeyId };
      },
    };
  } catch {
    return null;
  }
}

function reconcile(
  options: EmailStartupOptions,
  inbox: ReturnType<typeof createEmailFeedbackInboxRepository>,
  appDatabase: Pick<TenantWrappers, 'withTenant'>,
  keys: NonNullable<ReturnType<typeof feedbackKeys>>,
): ReconcileEmailFeedback {
  const retrieval = createResendEmailRetriever({ apiKey: keys.apiKey, identify: keys.identify });
  return new ReconcileEmailFeedback(
    inbox,
    createEmailFeedbackTenantRepository(appDatabase),
    retrieval,
    options.clock,
    options.ids,
  );
}

function recover(
  options: EmailStartupOptions,
  inbox: ReturnType<typeof createEmailFeedbackInboxRepository>,
  queue: Pick<Queue, 'add'>,
): RecoverEmailFeedback {
  return new RecoverEmailFeedback(
    inbox,
    {
      enqueue: async (id) => {
        const job = emailFeedbackJob(id);
        await queue.add(job.name, job.data, job.options);
      },
    },
    options.clock,
  );
}

async function countQuarantined(database: PlatformEmailDatabase): Promise<number> {
  const [row] = await database.withGlobal(
    (tx) =>
      tx.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM public.platform_email_feedback_inbox
        WHERE quarantined_at IS NOT NULL`),
    5_000,
  );
  return row?.count ?? 0;
}

async function scheduleMaintenance(queue: Queue): Promise<void> {
  const jobs: readonly [string, number][] = [
    [RECOVER_JOB, 30_000],
    [CLEAR_JOB, 60 * 60 * 1000],
  ];
  for (const [name, every] of jobs) {
    await queue.upsertJobScheduler(
      name,
      { every },
      { name, data: {}, opts: { attempts: 1, removeOnComplete: true, removeOnFail: true } },
    );
  }
}
