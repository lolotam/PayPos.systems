import { createDatabase, createOutboxDispatcherDatabase } from '@pospay/db';
import {
  ATTENDANCE_STATEMENT_DOCUMENT_KIND,
  COMMISSION_STATEMENT_EXPORT_DOCUMENT_KIND,
} from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { Redis } from 'ioredis';

import { businessConsumers } from './business-consumers.ts';
import { createDeliverer } from './outbox/deliver.ts';
import { knownEventTypes } from './outbox/known-event-types.ts';
import {
  createNotificationModule,
  createInAppNotificationModule,
  readNotificationConfiguration,
  startEmailCapability,
  startPushCapability,
} from './modules/notifications/index.ts';
import { createDispatchLoop } from './outbox/dispatch-loop.ts';
import { createParkedCommissionSweep } from './outbox/parked-commission-sweep.ts';
import { retryDelayMs } from './outbox/retry-policy.ts';
import { readConfig } from './shared/config.ts';
import { WORKER_LOG_EVENTS } from './shared/log-events.ts';
import { createWorker } from './worker.ts';
import type { ReadinessCheck } from './shared/health.controller.ts';
import { startFilesWorker } from './modules/files/index.ts';
import { deliverFilesEvent } from './outbox/files-deliver.ts';
import {
  startOptionalCapabilities,
  type OptionalCapabilities,
} from './start-optional-capabilities.ts';
import { reportRatingTokenCapability } from './rating-token-capability.ts';
import {
  createAttendanceStatementReader,
  readEmployeeBusiness,
  startStaffWorker,
} from './modules/staff/index.ts';
import { startCatalogWorker } from './modules/catalog/index.ts';
import { businessPermissionHolders, companyOwners } from './modules/identity/index.ts';
import {
  daySessionsReader,
  startPackagePreviewWorker,
  startPackageSaleWorker,
  startPackageImportCommitWorker,
} from './modules/orders/index.ts';
import { closedRatingClaimsLifecycle } from './modules/customers/index.ts';
import { closeOptional, optionalWithin } from './shared/optional-capability.ts';
import {
  beginDocumentRendering,
  startCoreBeforeDocuments,
  type DocumentRendering,
} from './documents/start-documents.ts';
import { DocumentSourceRegistry } from './documents/source-registry.ts';
import { createAttendanceStatementSource } from './documents/sources/attendance-statement.source.ts';
import { createCommissionStatementSource } from './documents/sources/commission-statement.source.ts';
import { createCommissionStatementExportReader, createParkedCommissionAlert } from './modules/commissions/index.ts';
import { businessCalendar, businessTimeZone } from './modules/tenancy/index.ts';
import { startCommissionReminderWiring } from './commission-reminders.ts';
import { drainDispatchAndDocuments } from './documents/shutdown-drain.ts';

const config = readConfig(process.env);
const logger = createLogger(config.LOG_LEVEL, { events: WORKER_LOG_EVENTS });

const app = createDatabase({ url: config.DATABASE_URL, ids: systemUuidV7() });
const dispatcher = createOutboxDispatcherDatabase({ url: config.DISPATCHER_DATABASE_URL });
const redis = new Redis(config.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
// Attached before any connection event, so ioredis never prints raw errors outside the logger.
redis.on('error', (error: unknown) => logger.warn({ err: error }, 'redis connection error'));

// ADR-0019: استقبال STOP وin-app مستقلان؛ تفعيل OTP لا يفتح إرسال الشركات.
const production = process.env['NODE_ENV'] === 'production';
const files = startFilesWorker(app, systemUuidV7(), config.REDIS_URL, process.env);
const previews = startPackagePreviewWorker(app, files.readImportBytes, config.REDIS_URL, {
  now: () => new Date(),
});
const sales = startPackageSaleWorker(app, systemUuidV7(), {
  redisUrl: config.REDIS_URL,
  clock: { now: () => new Date() },
  transactionTimeoutMs: config.PACKAGE_SALE_TRANSACTION_TIMEOUT_MS,
});
// المستهلك مسجّل قبل المنتج (47-2d)؛ لا شيء يصدر PackageImportCommitRequested بعد في الإنتاج.
const imports = startPackageImportCommitWorker(app, systemUuidV7(), {
  redisUrl: config.REDIS_URL,
  clock: { now: () => new Date() },
  transactionTimeoutMs: config.PACKAGE_IMPORT_COMMIT_TRANSACTION_TIMEOUT_MS,
  retryDelayMs,
});
const staff = startStaffWorker(app, systemUuidV7(), config.REDIS_URL, { now: () => new Date() });
// قفل وفتح التصنيفات الكبيرة عملية خلفية واحدة لكل طلب؛ العامل نايم لحد ما يجي المنتج.
const catalog = startCatalogWorker(app, systemUuidV7(), config.REDIS_URL, {
  now: () => new Date(),
});
const email = await startEmailCapability({
  env: process.env,
  production,
  logger,
  ids: systemUuidV7(),
  clock: { now: () => new Date() },
});
// ADR-0052 قرار 2: جاهزية الدفع في العامل وحدها بتفعّل كتابة المحاولات؛ من غيرها مفيش دفع.
// وأحداث الإذن بتقعد في الـ outbox لحد ما الدفع يتفعّل، وبعد آخر محاولة في السياسة بتتوقف زي أي حدث سام.
const push = await startPushCapability({
  env: process.env,
  production,
  logger,
  clock: { now: () => new Date() },
  ids: systemUuidV7(),
  database: app,
  redisUrl: config.REDIS_URL,
  redis,
});
let notifications: ReturnType<typeof createNotificationModule> | null = null;
if (!production) {
  try {
    notifications = createNotificationModule({
      database: app,
      ids: systemUuidV7(),
      clock: { now: () => new Date() },
      configuration: readNotificationConfiguration(process.env),
      production,
      email: email.module,
      push: { enabled: push.enabled },
    });
  } catch {
    logger.warn(
      { capability: { name: 'TENANT_WHATSAPP', state: 'UNAVAILABLE', reason: 'SETUP_FAILED' } },
      'staff OTP capability',
    );
  }
}
// لو الموديول الكامل مش متاح بنعمل مستهلك الجرس والدفع بس، عشان محدش يفضل من غير مستهلك.
const inApp =
  production || notifications === null
    ? createInAppNotificationModule({
        database: app,
        ids: systemUuidV7(),
        clock: { now: () => new Date() },
        email: email.module,
        push: { enabled: push.enabled },
      })
    : null;
if (production)
  logger.info(
    { capability: { name: 'TENANT_WHATSAPP', state: 'DISABLED', reason: 'LIVE_NOT_AUTHORIZED' } },
    'staff OTP capability',
  );
let globalDatabase: OptionalCapabilities['database'];
let inbound: OptionalCapabilities['inbound'];
let otp: OptionalCapabilities['otp'];
let otpAuth: OptionalCapabilities['auth'];
let capabilityTimer: OptionalCapabilities['timer'];
let stopping = false;
let maintenance: OptionalCapabilities['maintenance'];
const businessDeliver = createDeliverer(
  app,
  [
    ...businessConsumers({
      files: files.consumer,
      notifications: notifications?.consumer ?? null,
      inApp: inApp?.consumer ?? null,
      newIds: systemUuidV7,
      clock: { now: () => new Date() },
      daySessions: daySessionsReader,
      commissions: {
        businessTimeZone,
        employeeBusiness: readEmployeeBusiness,
        businessCalendar,
        permissionHolders: businessPermissionHolders,
      },
    }),
  ],
  logger,
  {
    knownEventTypes: knownEventTypes(
      staff,
      notifications,
      inApp,
      previews,
      sales,
      imports,
      catalog,
    ),
  },
);
let queue: OptionalCapabilities['queue'];
let documents: DocumentRendering | undefined;
// حدث إذن الدفع بيروح للطابور بس لما الدفع جاهز؛ ولو مش جاهز التسليم يرجع زي ما هو.
const pushTransport = push.transport((claimed) => (queue?.deliver ?? businessDeliver)(claimed));
// تصميم 7: المجدول الحيّ ما بيشتغلش من الإقلاع، فالتركيب بيسجّل المسجّل المغلق بس.
const ratingClaims = closedRatingClaimsLifecycle();
const deliver: typeof businessDeliver = (event) =>
  previews.deliver(event, (event) =>
    sales.deliver(event, (event) =>
      imports.deliver(event, (event) =>
        catalog.deliver(event, (event) =>
          // تسجيل جدولة التذكيرات بيحصل قبل أي علامة استهلاك (ADR-0061 §2).
          commissionReminders.delivery(event, (claimed) =>
            deliverFilesEvent(claimed, {
              register: (claimed) => files.deliver(claimed),
              staff: (claimed, next) => staff.deliver(claimed, next),
              core: (claimed) => ratingClaims.deliver(claimed, pushTransport),
            }),
          ),
        ),
      ),
    ),
  );
const parkAlert = createParkedCommissionAlert({
  database: app,
  ids: systemUuidV7(),
  clock: { now: () => new Date() },
  owners: companyOwners,
});
// المسح الدوري هو المصدر الوحيد لتنبيه المالك عن حدث عمولة وقف (ADR-0012 §3): الـdispatcher
// بيقرا الصفحات بس، والتنبيه بيتكتب في معاملة الشركة مع علامة التكرار.
const parkedSweep = createParkedCommissionSweep({
  readPage: (afterSeq, limit) => dispatcher.commissionParkedEventPage(afterSeq, limit),
  raiseAlert: parkAlert,
  logger,
});
// استعادة جدولة التذكيرات (ADR-0061): الجدولة كلها في Redis، فالخسارة بتوقف التذكيرات
// بصمت. التسجيل والاستعادة بيعملوا في Redis بره معاملة قاعدة البيانات.
const commissionReminders = startCommissionReminderWiring({
  app,
  dispatcher,
  redisUrl: config.REDIS_URL,
  logger,
});
const loop = createDispatchLoop({
  dispatcher,
  deliver,
  logger,
  sweepParkedCommissionAlerts: parkedSweep,
});

const release = async (): Promise<void> => {
  stopping = true;
  clearInterval(capabilityTimer);
  commissionReminders.stop();
  // تثبيت الاستيراد أول عامل يُغلق وبالقوة: الإغلاق القسري لا ينتظر، ويمنعه من بدء تثبيت مالي جديد بينما بقية العمال تُصفّى.
  await imports.close();
  // ننتظر فحص الملفات الجاري قبل إغلاق اتصال قاعدة البيانات.
  await previews.close();
  await sales.close();
  await files.close();
  await staff.close();
  await catalog.close();
  // المسجّل المغلق ما عندوش موارد، بس الإغلاق بيبقى في مسار الإيقاف زي أي بقية.
  await ratingClaims.close();
  // المتصفح بيتقفل بعد تصفية الطابور، مش مع إيقاف الحلقة.
  await documents?.close();
  await optionalWithin(
    () =>
      Promise.allSettled([
        inbound?.close(true),
        otp?.close(true),
        otpAuth?.close(),
        maintenance?.close(),
        globalDatabase?.close(true),
        queue?.close(true),
        push.close(true),
        email.close(),
        dispatcher.close(),
        app.close(),
        commissionReminders.close(),
        redis.quit(),
      ]),
    5000,
  ).catch(() => undefined);
  redis.disconnect();
};

/** فحوص الجاهزية بالترتيب: كل اعتماد لازم يرد قبل ما العامل يبقى جاهز. */
function readinessChecks(): readonly ReadinessCheck[] {
  return [
    { name: 'database', check: () => app.ping() },
    { name: 'package-previews', check: () => previews.ready() },
    { name: 'package-sale', check: () => sales.ready() },
    { name: 'package-import-commit', check: () => imports.ready() },
    { name: 'leave-history-reports', check: () => staff.reportsReady() },
    { name: 'service-category-closing', check: () => catalog.ready() },
    // A wrong dispatcher URL or password leaves the worker with nothing to do — it is not ready.
    { name: 'dispatcher', check: () => dispatcher.ping() },
    {
      name: 'redis',
      check: async () => {
        await redis.ping();
      },
    },
    {
      // الجاهزية ما بتضعفش عن الاستعادة: نفس الشروط اللي بيحكم فيها المسار (ADR-0061 §4).
      name: 'commission-reminder-recovery',
      check: () => commissionReminders.readiness(),
    },
  ];
}

async function startWorkerCore(): Promise<void> {
  reportRatingTokenCapability(process.env, logger);
  const started = await startOptionalCapabilities({
    env: process.env,
    logger,
    notifications,
    redisUrl: config.REDIS_URL,
    businessDeliver,
    intakeUrl: config.PLATFORM_NOTIFICATIONS_DATABASE_URL,
    redis,
    stopping: () => stopping,
  });
  maintenance = started.maintenance;
  queue = started.queue;
  globalDatabase = started.database;
  inbound = started.inbound;
  otp = started.otp;
  otpAuth = started.auth;
  capabilityTimer = started.timer;
  const worker = await createWorker(
    {
      readiness: readinessChecks(),
      stopPolling: async () => {
        stopping = true;
        email.stop();
        maintenance?.stop();
        await closeOptional([() => push.stop()]);
        await drainDispatchAndDocuments({
          stopDispatch: () => loop.stop(),
          stopDocuments: () => documents?.stop(),
          stopQueue: () => queue?.stop(),
          stopInbound: () => inbound?.stop(),
        });
        clearInterval(capabilityTimer);
        await closeOptional([() => otp?.stop()]);
      },
      release,
    },
    logger,
  );
  worker.enableShutdownHooks();
  await worker.listen({ host: config.WORKER_HOST, port: config.WORKER_PORT });
  loop.start();
}

try {
  documents = await startCoreBeforeDocuments({
    startCore: startWorkerCore,
    beginDocuments: () => {
      // FR-010: النوع بيتسجل هنا في composition root، والمصدر نفسه بياخد القراءين محقونين.
      const registry = new DocumentSourceRegistry();
      registry.register(
        ATTENDANCE_STATEMENT_DOCUMENT_KIND,
        createAttendanceStatementSource({
          readStatement: createAttendanceStatementReader(app),
          readLogo: files.readStatementLogo,
          clock: { now: () => new Date() },
        }),
      );
      registry.register(
        COMMISSION_STATEMENT_EXPORT_DOCUMENT_KIND,
        createCommissionStatementSource({
          readExport: createCommissionStatementExportReader(app),
        }),
      );
      return beginDocumentRendering({
        redis,
        redisUrl: config.REDIS_URL,
        logger,
        clock: { now: () => Date.now() },
        isStopping: () => stopping,
        registry,
      });
    },
    isStopping: () => stopping,
  });
  void documents.started.catch(() => undefined);
} catch (error) {
  // Only the sanitised diagnostic is logged — the error's message can carry a connection string.
  logger.fatal({ err: error }, 'worker failed to start');
  await loop.stop();
  await release();
  process.exit(1);
}
