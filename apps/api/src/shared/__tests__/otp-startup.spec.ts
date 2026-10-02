import { afterEach, expect, it, vi } from 'vitest';

const resources = vi.hoisted(() => ({
  database: { close: vi.fn(), ping: vi.fn() },
  intake: { close: vi.fn(), ready: vi.fn() },
  listen: vi.fn(),
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
  createAuth: async () => ({ close: vi.fn(), staff: {} }),
  createStaffOtpApi: vi.fn(),
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
vi.mock('../../app.ts', () => ({
  createApp: async () => ({
    listen: resources.listen,
    enableShutdownHooks: vi.fn(),
  }),
}));
vi.mock('../../modules/notifications/index.ts', () => ({
  createWhatsappIntake: () => resources.intake,
}));
vi.mock('../../modules/identity/index.ts', () => ({ staffOtpDependencies: vi.fn() }));
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('OTP activation cannot silently discard a failing intake and continue API startup', async () => {
  vi.stubEnv('STAFF_OTP_ENABLED', 'true');
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('SYNTHETIC_EXIT');
  });
  await expect(import('../../main.ts')).rejects.toThrow('SYNTHETIC_EXIT');
  expect(exit).toHaveBeenCalledWith(1);
  expect(resources.listen).not.toHaveBeenCalled();
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
