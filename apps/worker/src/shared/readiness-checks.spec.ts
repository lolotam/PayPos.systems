import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { HealthController } from './health.controller.ts';
import type * as Notifications from '@pospay/notifications';
import type * as StaffModule from '../modules/staff/index.ts';
import type * as NotificationModule from '../modules/notifications/index.ts';
import type * as Customers from '../modules/customers/index.ts';
import type * as BullMq from 'bullmq';
// التحميل المبكر يمنع التحويل البارد من استهلاك مهلة العزل أثناء استيراد main.
import 'bullmq';
import '../modules/notifications/index.ts';
import '../modules/staff/index.ts';
import '../modules/customers/index.ts';
import '../modules/orders/index.ts';

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
  previews: { ready: vi.fn(async () => undefined), close: vi.fn(async () => undefined) },
  reports: { ready: vi.fn(async () => undefined) },
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
  Redis: class Redis {
    duplicate() {
      return new Redis();
    }
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
// الوحدة الحقيقية بتتحمّل مرة واحدة بس؛ إعادة ضبط الموديولات لا تعيد التحميل البارد.
const bullmqActual = vi.hoisted(() => ({ module: undefined as typeof BullMq | undefined }));
vi.mock('bullmq', async (original) => {
  const actual = bullmqActual.module ?? (await original<typeof BullMq>());
  bullmqActual.module = actual;
  const record =
    (kind: string) =>
    (target: unknown, args: unknown[]): object => {
      resources.bullmq.constructed.push({ kind, name: String(args[0]) });
      // طابور بيع الباقة ومسح الاسترداد وقفل التصنيفات بيتبنوا فعليًا؛ بدل Redis حقيقي بنرجّع مقبض جاهز.
      if (String(args[0]).startsWith('package-sale') || args[0] === 'service-category-closing')
        return { on: vi.fn(), waitUntilReady: async () => undefined, close: async () => undefined };
      if (args[0] === 'package-import-preview')
        return {
          on: vi.fn(),
          waitUntilReady: resources.previews.ready,
          close: resources.previews.close,
        };
      return Reflect.construct(target as new (...rest: unknown[]) => object, args);
    };
  return {
    ...actual,
    Queue: new Proxy(actual.Queue, { construct: record('queue') }),
    Worker: new Proxy(actual.Worker, { construct: record('worker') }),
  };
});
// موديل العملاء ثقيل؛ التخزين هنا يمنع تكرار كلفة التحميل بعد resetModules.
const customersActual = vi.hoisted(() => ({ module: undefined as typeof Customers | undefined }));
vi.mock('../modules/customers/index.ts', async (original) => {
  const actual = customersActual.module ?? (await original<typeof Customers>());
  customersActual.module = actual;
  return {
    ...actual,
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
    reportsReady: resources.reports.ready,
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
    PACKAGE_SALE_TRANSACTION_TIMEOUT_MS: 30_000,
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
  resources.previews.ready.mockResolvedValue(undefined);
  resources.reports.ready.mockResolvedValue(undefined);
});
afterEach(async () => {
  await resources.workerOptions.mock.calls.at(-1)?.[0]?.release?.();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function readinessResponse() {
  const options = resources.workerOptions.mock.calls.at(-1)?.[0];
  const app = Fastify();
  app.get('/ready', (_request, reply) => new HealthController(options.readiness).ready(reply));
  try {
    return await app.inject('/ready');
  } finally {
    await app.close();
  }
}

it('package preview readiness remains required alongside optional OTP isolation', async () => {
  await import('../main.ts');
  resources.previews.ready.mockRejectedValueOnce(new Error('SYNTHETIC_PREVIEW_UNAVAILABLE'));
  const response = await readinessResponse();
  expect(response.statusCode).toBe(503);
  expect(response.json()).toMatchObject({
    code: 'NOT_READY',
    details: {
      checks: { 'package-previews': 'down', database: 'up', dispatcher: 'up', redis: 'up' },
    },
  });
});

it('leave history readiness is 503 with only leave-history-reports down', async () => {
  await import('../main.ts');
  resources.reports.ready.mockRejectedValueOnce(new Error('SYNTHETIC_REPORT_UNAVAILABLE'));
  const response = await readinessResponse();
  expect(response.statusCode).toBe(503);
  expect(response.json()).toMatchObject({
    code: 'NOT_READY',
    details: {
      checks: {
        'leave-history-reports': 'down',
        'package-previews': 'up',
        database: 'up',
        dispatcher: 'up',
        redis: 'up',
      },
    },
  });
});
