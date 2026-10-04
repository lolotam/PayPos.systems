import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { HealthController } from './health.controller.ts';
import type * as Notifications from '@pospay/notifications';
import type * as StaffModule from '../modules/staff/index.ts';
import type * as NotificationModule from '../modules/notifications/index.ts';
// تحميل تركيب القنوات خارج مهلة اختبار بدء التشغيل حتى لا يستهلك التحويل البارد مهلة العزل.
import '../modules/notifications/index.ts';

const resources = vi.hoisted(() => ({
  database: { close: vi.fn(async () => undefined), ping: vi.fn() },
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
    set = vi.fn();
    del = vi.fn();
  },
}));
vi.mock('../worker.ts', () => ({
  createWorker: async (options: unknown) => {
    resources.workerOptions(options);
    return {
      listen: resources.listen,
      enableShutdownHooks: vi.fn(),
    };
  },
}));
vi.mock('../outbox/deliver.ts', () => ({ createDeliverer: vi.fn() }));
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
