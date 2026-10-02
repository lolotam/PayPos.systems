import { afterEach, expect, it, vi } from 'vitest';

const resources = vi.hoisted(() => ({
  database: { close: vi.fn(async () => undefined), ping: vi.fn() },
  loop: { stop: vi.fn(), start: vi.fn() },
  listen: vi.fn(),
  workerOptions: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), fatal: vi.fn() },
}));
vi.mock('@pospay/db', () => ({
  createDatabase: () => resources.database,
  createOutboxDispatcherDatabase: () => resources.database,
  createPlatformWhatsappDatabase: () => ({
    ...resources.database,
    ping: async () => {
      throw new Error('SYNTHETIC_INTAKE_FAILURE');
    },
  }),
}));
vi.mock('@pospay/auth', () => ({
  createStaffOtpExecution: vi.fn(),
  createStaffOtpMaintenance: vi.fn(),
  readStaffOtpConfiguration: () => ({ state: 'DISABLED' }),
}));
vi.mock('@pospay/observability', () => ({ createLogger: () => resources.logger }));
vi.mock('ioredis', () => ({
  Redis: class {
    on() {}
    quit = vi.fn();
    disconnect = vi.fn();
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
vi.mock('../modules/notifications/index.ts', () => ({
  createNotificationModule: vi.fn(),
  createInAppNotificationModule: () => ({ eventTypes: [] }),
  startWhatsappInbound: vi.fn(),
  readNotificationConfiguration: vi.fn(),
  startNotificationQueue: vi.fn(),
  startStaffOtpWorker: vi.fn(),
}));
vi.mock('./config.ts', () => ({
  readConfig: () => ({
    DATABASE_URL: 'synthetic',
    DISPATCHER_DATABASE_URL: 'synthetic',
    REDIS_URL: 'synthetic',
    PLATFORM_NOTIFICATIONS_DATABASE_URL: 'synthetic',
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

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
