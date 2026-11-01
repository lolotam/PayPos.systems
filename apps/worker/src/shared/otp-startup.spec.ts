import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { HealthController } from './health.controller.ts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import type * as Notifications from '@pospay/notifications';
import type * as StaffModule from '../modules/staff/index.ts';
import type * as NotificationModule from '../modules/notifications/index.ts';
import type * as Customers from '../modules/customers/index.ts';
import type * as BullMq from 'bullmq';
import { RATING_CLAIMS_QUEUE } from '../modules/customers/jobs/rating-claims.processor.ts';
// تحميل تركيب القنوات ووظائف staff خارج مهلة بدء التشغيل حتى لا يستهلك التحويل البارد مهلة العزل.
// تحميل bullmq كمان بره الاختبارات: التحميل البارد كان بيقع جوّه أول اختبار وبياكل مهلة العزل.
import 'bullmq';
import '../modules/notifications/index.ts';
import '../modules/staff/index.ts';
// موديل العملاء بره الاختبارات: هو أتقل رسم بياني في الإقلاع، وتحميله البارد كان بيقع
// جوّه الاختبار فياكل مهلة العزل، والاختبار اللي بعده بيلاقي بدء تشغيل شغّال معاه.
import '../modules/customers/index.ts';

const resources = vi.hoisted(() => ({
  database: { close: vi.fn(async () => undefined), ping: vi.fn(), withTenant: vi.fn() },
  loop: { stop: vi.fn(), start: vi.fn() },
  listen: vi.fn(),
  workerOptions: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), fatal: vi.fn() },
  global: { ping: vi.fn(), close: vi.fn() },
  inbound: { ready: vi.fn(), stop: vi.fn(), close: vi.fn() },
  configuration: { state: 'DISABLED' as 'DISABLED' | 'READY', fingerprint: 'synthetic-worker' },
  execution: { readiness: vi.fn(), close: vi.fn() },
  otp: { ready: vi.fn(), stop: vi.fn(), close: vi.fn() },
  otpOptions: vi.fn(),
  bullmq: { constructed: [] as { kind: string; name: string }[] },
  redis: { set: vi.fn(), del: vi.fn(), get: vi.fn(), evalsha: vi.fn() },
  ratingClaims: undefined as Customers.RatingClaimsLifecycle | undefined,
  deliverer: vi.fn(),
  maintenance: vi.fn((options: { databaseUrl: string }) => {
    new URL(options.databaseUrl);
    return { readiness: vi.fn(), stop: vi.fn(), close: vi.fn() };
  }),
}));
vi.mock('@pospay/db', () => ({
  createDatabase: () => resources.database,
  createOutboxDispatcherDatabase: () => resources.database,
  createPlatformWhatsappDatabase: () => resources.global,
}));
vi.mock('@pospay/auth', () => ({
  createStaffOtpExecution: () => resources.execution,
  createStaffOtpMaintenance: resources.maintenance,
  readStaffOtpConfiguration: () => resources.configuration,
}));
vi.mock('@pospay/observability', () => ({ createLogger: () => resources.logger }));
vi.mock('ioredis', () => ({
  Redis: class {
    on() {}
    quit = vi.fn();
    disconnect = vi.fn();
    ping = vi.fn();
    set = resources.redis.set;
    del = resources.redis.del;
    get = resources.redis.get;
    evalsha = resources.redis.evalsha;
  },
}));
// الطابور والعامل الحقيقيين بيسجّلوا اللي اتعمل، عشان نعرف إن مجدول المطالبات ما اتفتحش.
// الوحدة الحقيقية بتتحمّل مرة واحدة بس: بعد إعادة ضبط الموديولات مفيش تحميل بارد تاني.
const bullmqActual = vi.hoisted(() => ({ module: undefined as typeof BullMq | undefined }));
vi.mock('bullmq', async (original) => {
  const actual = bullmqActual.module ?? (await original<typeof BullMq>());
  bullmqActual.module = actual;
  const record =
    (kind: string) =>
    (target: unknown, args: unknown[]): object => {
      resources.bullmq.constructed.push({ kind, name: String(args[0]) });
      return Reflect.construct(target as new (...rest: unknown[]) => object, args);
    };
  return {
    ...actual,
    Queue: new Proxy(actual.Queue, { construct: record('queue') }),
    Worker: new Proxy(actual.Worker, { construct: record('worker') }),
  };
});
// موديل العملاء بيتحمل مرة واحدة بس: بعد إعادة ضبط الموديولات مفيش تحميل بارد تاني،
// لأن الرسم البياني بتاعه أتقل واحد في الإقلاع وبياكل مهلة عزل الاختبار.
const customersActual = vi.hoisted(() => ({ module: undefined as typeof Customers | undefined }));
vi.mock('../modules/customers/index.ts', async (original) => {
  const actual = customersActual.module ?? (await original<typeof Customers>());
  customersActual.module = actual;
  return {
    ...actual,
    // المجدول المُسجّل في الإقلاع بيتشقط هنا، عشان الاختبار يمرّر بيه حدث.
    closedRatingClaimsLifecycle: () => {
      const lifecycle = actual.closedRatingClaimsLifecycle();
      resources.ratingClaims = lifecycle;
      return lifecycle;
    },
  };
});
vi.mock('../worker.ts', () => ({
  createWorker: async (options: unknown) => {
    resources.workerOptions(options);
    return {
      listen: resources.listen,
      enableShutdownHooks: vi.fn(),
    };
  },
}));
vi.mock('../outbox/deliver.ts', () => ({
  createDeliverer: vi.fn((...args: unknown[]) => {
    resources.deliverer(...args);
    return undefined;
  }),
}));
vi.mock('../outbox/dispatch-loop.ts', () => ({ createDispatchLoop: () => resources.loop }));
vi.mock('../modules/notifications/index.ts', async (original) => ({
  ...(await original<typeof NotificationModule>()),
  createNotificationModule: vi.fn(),
  createInAppNotificationModule: () => ({ eventTypes: [] }),
  startWhatsappInbound: () => resources.inbound,
  readNotificationConfiguration: vi.fn(),
  startNotificationQueue: vi.fn(),
  startStaffOtpWorker: (options: unknown) => {
    resources.otpOptions(options);
    return resources.otp;
  },
}));
// جدول الخروج المفقود يحتاج Redis حقيقياً؛ هنا يُعزل كي يبقى الاختبار عن جاهزية OTP فقط.
// معالجات الاحتفاظ تفتح Redis؛ هذا الاختبار يعزل جاهزية OTP فقط.
vi.mock('../modules/files/index.ts', () => ({
  startFilesWorker: () => ({
    consumer: { eventTypes: [] },
    deliver: vi.fn(),
    close: vi.fn(async () => undefined),
  }),
}));
vi.mock('../modules/staff/index.ts', async (original) => ({
  ...(await original<typeof StaffModule>()),
  startStaffWorker: () => ({
    eventTypes: [],
    deliver: vi.fn(),
    ready: vi.fn(),
    close: vi.fn(async () => undefined),
  }),
}));
vi.mock('@pospay/notifications', async (original) => ({
  ...(await original<typeof Notifications>()),
  readWhatsappWebhookConfiguration: vi.fn(),
}));
vi.mock('./config.ts', () => ({
  readConfig: () => ({
    DATABASE_URL: 'synthetic',
    DISPATCHER_DATABASE_URL: 'synthetic',
    REDIS_URL: 'synthetic',
    PLATFORM_NOTIFICATIONS_DATABASE_URL: 'synthetic',
  }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  resources.bullmq.constructed.length = 0;
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('AUTH_DATABASE_URL', '');
  resources.global.ping.mockRejectedValue(new Error('SYNTHETIC_INTAKE_FAILURE'));
  resources.global.close.mockResolvedValue(undefined);
  resources.inbound.close.mockResolvedValue(undefined);
  resources.inbound.ready.mockResolvedValue(undefined);
  resources.configuration.state = 'DISABLED';
  resources.execution.readiness.mockResolvedValue(undefined);
  resources.execution.close.mockResolvedValue(undefined);
  resources.otp.close.mockResolvedValue(undefined);
});
afterEach(async () => {
  await resources.workerOptions.mock.calls.at(-1)?.[0]?.release?.();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function ordinaryReadiness() {
  const options = resources.workerOptions.mock.calls.at(-1)?.[0];
  const app = Fastify();
  app.get('/ready', (_request, reply) => new HealthController(options.readiness).ready(reply));
  try {
    expect((await app.inject('/ready')).statusCode).toBe(200);
  } finally {
    await app.close();
  }
}

it('hung optional intake readiness and cleanup cannot prevent worker /ready 200', async () => {
  resources.global.ping.mockResolvedValue(undefined);
  resources.inbound.ready.mockImplementation(() => new Promise(() => undefined));
  resources.inbound.close.mockImplementation(() => new Promise(() => undefined));
  await import('../main.ts');
  expect(resources.listen).toHaveBeenCalledOnce();
  expect(resources.inbound.close).toHaveBeenCalledWith(true);
  expect(resources.logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({ capability: expect.objectContaining({ state: 'UNAVAILABLE' }) }),
    'staff OTP capability',
  );
  await ordinaryReadiness();
}, 5000);

it('malformed optional auth URL disables maintenance without preventing worker /ready 200', async () => {
  vi.stubEnv('AUTH_DATABASE_URL', 'synthetic-invalid');
  await import('../main.ts');
  expect(resources.listen).toHaveBeenCalledOnce();
  expect(resources.logger.fatal).not.toHaveBeenCalled();
  expect(resources.logger.warn).toHaveBeenCalledWith(
    { capability: { name: 'STAFF_MAINTENANCE', state: 'UNAVAILABLE', reason: 'SETUP_FAILED' } },
    'staff OTP capability',
  );
  await ordinaryReadiness();
});

it('invalid email identity settings disable email alone without affecting ordinary readiness', async () => {
  vi.stubEnv('NOTIFICATION_EMAIL_HASH_KEY', 'synthetic-short');
  vi.stubEnv('NOTIFICATION_EMAIL_HASH_KEY_ID', 'synthetic-email');
  await import('../main.ts');
  expect(resources.listen).toHaveBeenCalledOnce();
  expect(resources.logger.fatal).not.toHaveBeenCalled();
  expect(resources.logger.info).toHaveBeenCalledWith(
    {
      capability: {
        channel: 'email',
        enabled: false,
        reason: 'EMAIL_FEEDBACK_NOT_IMPLEMENTED',
        name: 'EMAIL',
        state: 'UNAVAILABLE',
      },
    },
    'email disabled',
  );
  await ordinaryReadiness();
  const options = resources.workerOptions.mock.calls.at(-1)?.[0];
  expect(options.readiness.map((check: { name: string }) => check.name)).toEqual([
    'database',
    'dispatcher',
    'redis',
  ]);
});

it('hung optional intake database readiness is force-closed before worker listens', async () => {
  resources.global.ping.mockImplementation(() => new Promise(() => undefined));
  await import('../main.ts');
  expect(resources.global.close).toHaveBeenCalledWith(true);
  expect(resources.listen).toHaveBeenCalledOnce();
  await ordinaryReadiness();
}, 5000);

it('hung maintenance readiness and cleanup are isolated from worker /ready', async () => {
  const retention = {
    readiness: vi.fn(() => new Promise<void>(() => undefined)),
    stop: vi.fn(),
    close: vi.fn(() => new Promise<void>(() => undefined)),
  };
  resources.maintenance.mockReturnValueOnce(retention);
  vi.stubEnv('AUTH_DATABASE_URL', 'postgres://synthetic.invalid/synthetic');
  await import('../main.ts');
  expect(retention.stop).toHaveBeenCalledOnce();
  expect(retention.close).toHaveBeenCalledOnce();
  expect(resources.listen).toHaveBeenCalledOnce();
  await ordinaryReadiness();
}, 5000);

it('hung OTP worker readiness and cleanup are isolated from ordinary worker /ready', async () => {
  const readinessWhileClosing = vi.fn();
  resources.configuration.state = 'READY';
  resources.global.ping.mockResolvedValue(undefined);
  resources.otp.ready.mockImplementation(() => new Promise(() => undefined));
  resources.otp.close.mockImplementation(() => new Promise(() => undefined));
  resources.execution.close.mockImplementationOnce(async () => {
    readinessWhileClosing(await resources.otpOptions.mock.calls[0]?.[0].capability.ready());
  });
  vi.stubEnv('NOTIFICATION_PHONE_HASH_KEY', 'synthetic'.repeat(8));
  vi.stubEnv('NOTIFICATION_PHONE_HASH_KEY_ID', 'synthetic-h');
  await import('../main.ts');
  expect(resources.otp.close).toHaveBeenCalledWith(true);
  expect(resources.execution.close).toHaveBeenCalledOnce();
  expect(readinessWhileClosing).toHaveBeenCalledWith(false);
  expect(resources.listen).toHaveBeenCalledOnce();
  expect(await resources.otpOptions.mock.calls[0]?.[0].capability.ready()).toBe(false);
  expect(resources.otpOptions.mock.calls[0]?.[0].capability.available()).toBe(false);
  await ordinaryReadiness();
}, 5000);

it('hung final OTP readiness cannot advertise READY or retain an unsuccessful worker', async () => {
  resources.configuration.state = 'READY';
  resources.global.ping.mockResolvedValue(undefined);
  resources.otp.ready.mockResolvedValue(undefined);
  resources.execution.readiness
    .mockImplementation(() => new Promise(() => undefined))
    .mockResolvedValueOnce(undefined);
  vi.stubEnv('NOTIFICATION_PHONE_HASH_KEY', 'synthetic'.repeat(8));
  vi.stubEnv('NOTIFICATION_PHONE_HASH_KEY_ID', 'synthetic-h');
  await import('../main.ts');
  expect(resources.otp.close).toHaveBeenCalledWith(true);
  expect(resources.logger.info).toHaveBeenLastCalledWith(
    { capability: { name: 'STAFF_LOGIN', state: 'UNAVAILABLE' } },
    'staff OTP capability',
  );
  expect(resources.listen).toHaveBeenCalledOnce();
  await ordinaryReadiness();
}, 5000);

it('a failing optional intake is diagnosed and isolated from ordinary worker readiness', async () => {
  vi.stubEnv('STAFF_OTP_ENABLED', 'true');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('AUTH_DATABASE_URL', '');
  vi.stubEnv('PLATFORM_NOTIFICATIONS_DATABASE_URL', 'synthetic');
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('SYNTHETIC_EXIT');
  });
  await expect(import('../main.ts')).resolves.toBeDefined();
  expect(exit).not.toHaveBeenCalled();
  expect(resources.listen).toHaveBeenCalledOnce();
  expect(resources.loop.start).toHaveBeenCalledOnce();
  expect(resources.workerOptions).toHaveBeenCalledWith(
    expect.objectContaining({
      readiness: expect.not.arrayContaining([
        expect.objectContaining({ name: 'whatsapp-inbound' }),
      ]),
    }),
  );
  expect(resources.logger.fatal).not.toHaveBeenCalled();
  expect(resources.logger.warn).toHaveBeenCalledWith(
    {
      capability: {
        name: 'WHATSAPP_INTAKE',
        state: 'UNAVAILABLE',
        reason: 'SETUP_FAILED',
      },
    },
    'staff OTP capability',
  );
});

// التصميم 7: المجدول الحيّ ما بيشتغلش من الإقلاع. مع إعدادات رموز صالحة، العامل
// بيقلع عادي، ومفيش طابور ولا عامل ولا حالة Redis لمجدول طلبات التقييم.
it('runtime_stays_dormant_with_valid_token_settings', async () => {
  vi.stubEnv('RATING_TOKEN_DERIVATION_KEY', 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=');
  vi.stubEnv('RATING_TOKEN_DERIVATION_KEY_VERSION', '1');
  await import('../main.ts');
  expect(resources.logger.info).toHaveBeenCalledWith(
    expect.objectContaining({
      capability: expect.objectContaining({ name: 'RATING_TOKENS', state: 'READY' }),
    }),
    'rating token capability',
  );
  const lifecycle = resources.ratingClaims;
  expect(lifecycle).toBeDefined();
  // الحدث يعدّي من المجدول المسجّل في الإقلاع، فبيعدّي زي ما هو من غير ما يفتح
  // طابور: المجدول بيبني الطابور بس لو الحدث هو اللي طلبه.
  const event: ClaimedEvent = {
    companyId: '01920000-0000-7000-8000-0000000000a1',
    id: '01920000-0000-7000-8000-0000000000a2',
    aggregateType: 'service_session',
    aggregateId: '01920000-0000-7000-8000-0000000000a3',
    eventType: 'ServiceSessionRecorded',
    payload: {},
    attempt: 1,
  };
  const next = vi.fn(async (): Promise<DeliveryOutcome> => ({ delivered: true }));
  const outcome = await lifecycle?.deliver(event, next);
  expect(outcome?.delivered).toBe(true);
  expect(next).toHaveBeenCalledOnce();
  expect(next).toHaveBeenCalledWith(event);
  // مفيش طابور ولا عامل اتفتحوا: لا وقت الإقلاع ولا وقت الحدث.
  expect(
    resources.bullmq.constructed.filter((entry) => entry.name === RATING_CLAIMS_QUEUE),
  ).toEqual([]);
  // منفذ حالة الجدولة بيكتب بـ eval، فمفيش eval ولا evalsha حصل.
  expect(resources.redis.evalsha).not.toHaveBeenCalled();
  const written = resources.redis.set.mock.calls
    .map((call) => call.map(String).join(' '))
    .join(' ');
  expect(written).not.toMatch(/rating-claims/);
  expect(resources.database.withTenant).not.toHaveBeenCalled();
});
