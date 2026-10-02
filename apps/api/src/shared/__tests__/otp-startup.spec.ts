import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { HealthController } from '../health.controller.ts';

const resources = vi.hoisted(() => ({
  database: { close: vi.fn(async () => undefined), ping: vi.fn() },
  intake: {
    close: vi.fn(async () => undefined),
    ready: vi.fn(async (): Promise<void> => {
      throw new Error('SYNTHETIC_INTAKE_FAILURE');
    }),
  },
  listen: vi.fn(),
  appOptions: vi.fn(),
  otpOptions: vi.fn(),
  configuration: { state: 'DISABLED' as 'READY' | 'DISABLED', fingerprint: 'synthetic-api' },
  transport: {
    ready: vi.fn(),
    close: vi.fn(async () => undefined),
    workerFingerprint: vi.fn(async () => 'synthetic-worker'),
  },
  logger: { info: vi.fn(), warn: vi.fn(), fatal: vi.fn() },
}));
vi.mock('@pospay/db', () => ({
  createDatabase: () => resources.database,
  createPlatformWhatsappDatabase: () => ({
    ...resources.database,
    ping: async () => {
      throw new Error('SYNTHETIC_INTAKE_FAILURE');
    },
  }),
}));
vi.mock('@pospay/auth', () => ({
  createAuth: async () => ({ close: vi.fn(), ping: vi.fn(), staff: {} }),
  createStaffOtpApi: (options: { capability: { ready(): Promise<boolean> } }) => {
    resources.otpOptions(options);
    return {
      state: async () => ((await options.capability.ready()) ? 'READY' : 'UNAVAILABLE'),
      readiness: vi.fn(),
      close: vi.fn(async () => undefined),
    };
  },
  readStaffOtpConfiguration: () => resources.configuration,
}));
vi.mock('@pospay/observability', () => ({ createLogger: () => resources.logger }));
vi.mock('ioredis', () => ({
  Redis: class {
    on() {}
    quit = vi.fn();
    disconnect = vi.fn();
    ping = vi.fn();
  },
}));
vi.mock('../../app.ts', () => ({
  createApp: async (options: unknown) => {
    resources.appOptions(options);
    return {
      listen: resources.listen,
      enableShutdownHooks: vi.fn(),
    };
  },
}));
vi.mock('../../modules/notifications/index.ts', () => ({
  createWhatsappIntake: () => resources.intake,
}));
vi.mock('../../modules/identity/index.ts', () => ({
  staffOtpDependencies: () => ({ transport: resources.transport, rates: {}, eligibility: {} }),
}));
vi.mock('../config.ts', () => ({
  readConfig: () => ({
    DATABASE_URL: 'synthetic',
    REDIS_URL: 'synthetic',
    AUTH_DATABASE_URL: 'synthetic',
    PLATFORM_NOTIFICATIONS_DATABASE_URL: 'synthetic',
    TRUSTED_PROXY_CIDRS: ['127.0.0.1/32'],
    AUTH_TRUSTED_ORIGINS: [],
    BETTER_AUTH_URL: 'https://api.synthetic.invalid',
  }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  resources.configuration.state = 'DISABLED';
  resources.intake.ready.mockRejectedValue(new Error('SYNTHETIC_INTAKE_FAILURE'));
  resources.intake.close.mockResolvedValue(undefined);
  resources.transport.ready.mockResolvedValue(undefined);
});

async function ordinaryReadiness() {
  const options = resources.appOptions.mock.calls.at(-1)?.[0];
  const app = Fastify();
  app.get('/ready', () => new HealthController(options.readiness).ready());
  try {
    expect((await app.inject('/ready')).statusCode).toBe(200);
  } finally {
    await app.close();
  }
}

it('hung optional intake readiness and cleanup cannot prevent listening or /ready 200', async () => {
  resources.intake.ready.mockImplementation(() => new Promise(() => undefined));
  resources.intake.close.mockImplementation(() => new Promise(() => undefined));
  await import('../../main.ts');
  expect(resources.listen).toHaveBeenCalledOnce();
  expect(resources.intake.close).toHaveBeenCalledWith(true);
  expect(resources.logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({ capability: expect.objectContaining({ state: 'UNAVAILABLE' }) }),
    'staff OTP capability',
  );
  await ordinaryReadiness();
}, 5000);

it('hung optional OTP readiness is closed while ordinary API /ready remains 200', async () => {
  resources.configuration.state = 'READY';
  resources.intake.ready.mockResolvedValue(undefined);
  resources.transport.ready.mockImplementation(() => new Promise(() => undefined));
  vi.stubEnv('NOTIFICATION_PHONE_HASH_KEY', 'synthetic'.repeat(8));
  vi.stubEnv('NOTIFICATION_PHONE_HASH_KEY_ID', 'synthetic-h');
  await import('../../main.ts');
  expect(resources.listen).toHaveBeenCalledOnce();
  expect(resources.transport.close).toHaveBeenCalledWith(true);
  expect(resources.appOptions.mock.calls.at(-1)?.[0]?.staff.api).toBeNull();
  await ordinaryReadiness();
}, 5000);
afterEach(async () => {
  await resources.appOptions.mock.calls.at(-1)?.[0]?.onShutdown?.();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('sender/STOP fingerprint disagreement refuses OTP while ordinary API startup remains healthy', async () => {
  resources.configuration.state = 'READY';
  resources.intake.ready.mockResolvedValue(undefined);
  vi.stubEnv('NOTIFICATION_PHONE_HASH_KEY', 'synthetic'.repeat(8));
  vi.stubEnv('NOTIFICATION_PHONE_HASH_KEY_ID', 'synthetic-h');
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('SYNTHETIC_EXIT');
  });
  await import('../../main.ts');
  expect(resources.listen).toHaveBeenCalledOnce();
  expect(exit).not.toHaveBeenCalled();
  expect(resources.otpOptions).toHaveBeenCalledOnce();
  expect(await resources.otpOptions.mock.calls[0]?.[0].capability.ready()).toBe(false);
  expect(resources.logger.info).toHaveBeenCalledWith(
    { capability: { name: 'STAFF_LOGIN', state: 'UNAVAILABLE' } },
    'staff OTP capability',
  );
  expect(resources.transport.close).not.toHaveBeenCalled();
  resources.transport.workerFingerprint.mockResolvedValueOnce('synthetic-api');
  expect(await resources.otpOptions.mock.calls[0]?.[0].capability.ready()).toBe(true);
});

it('a failing optional intake is diagnosed and isolated from ordinary API readiness', async () => {
  vi.stubEnv('STAFF_OTP_ENABLED', 'true');
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('SYNTHETIC_EXIT');
  });
  await expect(import('../../main.ts')).resolves.toBeDefined();
  expect(exit).not.toHaveBeenCalled();
  expect(resources.listen).toHaveBeenCalledOnce();
  expect(resources.appOptions).toHaveBeenCalledWith(
    expect.objectContaining({
      readiness: expect.not.arrayContaining([
        expect.objectContaining({ name: 'whatsapp-inbound' }),
      ]),
    }),
  );
  expect(resources.logger.fatal).not.toHaveBeenCalled();
  expect(resources.intake.close).toHaveBeenCalledOnce();
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
