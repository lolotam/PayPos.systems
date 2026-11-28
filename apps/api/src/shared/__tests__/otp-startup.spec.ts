import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type * as Auth from '@pospay/auth';
import type * as Notifications from '@pospay/notifications';
import { HealthController } from '../health.controller.ts';

const resources = vi.hoisted(() => ({
  configOverrides: {} as Partial<{ BETTER_AUTH_URL: string; AUTH_TRUSTED_ORIGINS: string[] }>,
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
  cardKey: Buffer.alloc(32, 41),
  deriveCardKey: vi.fn(),
  personalSessions: {},
  configuration: { state: 'DISABLED' as 'READY' | 'DISABLED', fingerprint: 'synthetic-api' },
  transport: {
    ready: vi.fn(),
    close: vi.fn(async () => undefined),
    workerFingerprint: vi.fn(async () => 'synthetic-worker'),
  },
  logger: { info: vi.fn(), warn: vi.fn(), fatal: vi.fn() },
  passwordReset: vi.fn<(options: unknown) => null>(() => null),
  // بيئة تهيئة البوابة: undefined يعني إن الاختبار ما يتحققش من إعدادات الواتساب، وobject يعني تحقق حقيقي.
  whatsappConfigEnv: undefined as NodeJS.ProcessEnv | undefined,
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
vi.mock('@pospay/auth', async () => {
  const { passkeyPolicy } = await vi.importActual<typeof Auth>('@pospay/auth');
  return {
    deriveEmployeeCardKey: (secret: string) => {
      resources.deriveCardKey(secret);
      return resources.cardKey;
    },
    createAuth: async () => ({
      close: vi.fn(),
      ping: vi.fn(),
      staff: {},
      personal: resources.personalSessions,
    }),
    passkeyPolicy,
    createStaffOtpApi: (options: { capability: { ready(): Promise<boolean> } }) => {
      resources.otpOptions(options);
      return {
        state: async () => ((await options.capability.ready()) ? 'READY' : 'UNAVAILABLE'),
        readiness: vi.fn(),
        close: vi.fn(async () => undefined),
      };
    },
    readStaffOtpConfiguration: () => resources.configuration,
  };
});
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
vi.mock('../../modules/notifications/index.ts', async () => {
  const { readWhatsappWebhookConfiguration } =
    await vi.importActual<typeof Notifications>('@pospay/notifications');
  return {
    // قراءة إعدادات البوابة الحقيقية بترمي الخطأ الأصلي قبل ما الـintake تتبنى، زي ما في الإقلاع.
    createWhatsappIntake: () => {
      if (resources.whatsappConfigEnv !== undefined)
        readWhatsappWebhookConfiguration(resources.whatsappConfigEnv);
      return resources.intake;
    },
  };
});
vi.mock('../../modules/identity/index.ts', () => ({
  // استرجاع كلمة المرور بالإيميل خارج نطاق هذا الاختبار: القدرة مقفولة فمفيش خدمة تتبنى.
  createPasswordResetCapability: (options: unknown) => resources.passwordReset(options),
  membershipCompanies: vi.fn(async () => []),
  staffOtpDependencies: () => ({ transport: resources.transport, rates: {}, eligibility: {} }),
}));
vi.mock('../../modules/staff/index.ts', () => ({
  createPersonalEligibility: () => ({}),
  createActivePasskeyBindings: () => ({}),
}));
// الاختبار يعزل تركيب OTP؛ لا نحمل SDK الملفات أو إعداداتها من .env داخل نافذة مهلة بدء OTP.
// تشغيل API وworker المبنيين مع الملفات والإعدادات الاختيارية الفارغة مغطى في files/production.spec.ts.
vi.mock('../../modules/files/index.ts', () => ({ filesRuntime: () => null }));
vi.mock('../config.ts', () => ({
  corsOriginsFrom: () => [],
  memberInvitationsDependency: () => ({}),
  readConfig: () => ({
    DATABASE_URL: 'synthetic',
    REDIS_URL: 'synthetic',
    AUTH_DATABASE_URL: 'synthetic',
    PLATFORM_NOTIFICATIONS_DATABASE_URL: 'synthetic',
    TRUSTED_PROXY_CIDRS: ['127.0.0.1/32'],
    AUTH_TRUSTED_ORIGINS: [],
    ADMIN_ORIGIN: '',
    BETTER_AUTH_URL: 'https://api.synthetic.invalid',
    BETTER_AUTH_SECRET: 'synthetic-auth-root-for-startup-tests',
    ...resources.configOverrides,
  }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  resources.configOverrides = {};
  resources.configuration.state = 'DISABLED';
  resources.whatsappConfigEnv = undefined;
  resources.intake.ready.mockRejectedValue(new Error('SYNTHETIC_INTAKE_FAILURE'));
  resources.intake.close.mockResolvedValue(undefined);
  resources.transport.ready.mockResolvedValue(undefined);
});

// شكل القدرة المكسورة في السجل: الاسم والحالة والسبب الآمن، من غير أي تفاصيل حساسة.
const whatsappCapability = (subReason: string) => ({
  name: 'WHATSAPP_INTAKE',
  state: 'UNAVAILABLE',
  reason: 'SETUP_FAILED',
  subReason,
});

// كل ما وصل للسجل من أي مستوى، عشان نثبت إن التفاصيل الحساسة ماتفحصتش في أي مكان.
function loggedArgs() {
  return JSON.stringify([
    ...resources.logger.info.mock.calls,
    ...resources.logger.warn.mock.calls,
    ...resources.logger.fatal.mock.calls,
  ]);
}

async function ordinaryReadiness() {
  const options = resources.appOptions.mock.calls.at(-1)?.[0];
  expect(resources.deriveCardKey).toHaveBeenCalledWith('synthetic-auth-root-for-startup-tests');
  expect(options.employeeCardKey).toBe(resources.cardKey);
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
    expect.objectContaining({
      capability: expect.objectContaining({
        name: 'WHATSAPP_INTAKE',
        state: 'UNAVAILABLE',
        reason: 'SETUP_FAILED',
        subReason: 'OPTIONAL_CAPABILITY_TIMEOUT',
      }),
    }),
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
  expect(resources.otpOptions).toHaveBeenCalledTimes(2);
  const [kiosk, personal] = resources.otpOptions.mock.calls.map(([options]) => options);
  expect(personal.sessions).toBe(resources.personalSessions);
  expect(personal.concurrency).toBe(kiosk.concurrency);
  expect(personal.rates).toBe(kiosk.rates);
  expect(personal.capability).toBe(kiosk.capability);
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
    { capability: whatsappCapability('UNKNOWN_SETUP_ERROR') },
    'staff OTP capability',
  );
});

it('a whatsapp setup configuration failure is reported with its safe reason code', async () => {
  resources.whatsappConfigEnv = {
    WHATSAPP_WABA_ID: 'synthetic-waba',
    WHATSAPP_PHONE_NUMBER_ID: 'synthetic-phone',
  };
  await import('../../main.ts');
  expect(resources.logger.warn).toHaveBeenCalledWith(
    { capability: whatsappCapability('WHATSAPP_CONFIG_INVALID:NOTIFICATION_PHONE_HASH_KEY_ID') },
    'staff OTP capability',
  );
});

it('a sensitive setup failure reports only its driver code and leaks no detail', async () => {
  resources.intake.ready.mockRejectedValue(
    Object.assign(new Error('secret-+96599999999-postgres://u:p@h/db'), { code: '28P01' }),
  );
  await import('../../main.ts');
  expect(resources.logger.warn).toHaveBeenCalledWith(
    { capability: whatsappCapability('DB_OR_IO_28P01') },
    'staff OTP capability',
  );
  const logged = loggedArgs();
  expect(logged).not.toContain('secret-+96599999999-postgres://u:p@h/db');
  expect(logged).not.toContain('96599999999');
  expect(logged).not.toContain('postgres://u:p@h/db');
});

it('an unknown setup failure reports no detail from its message', async () => {
  resources.intake.ready.mockRejectedValue(new Error('SYNTHETIC_UNKNOWN_SETUP_FAILURE'));
  await import('../../main.ts');
  expect(resources.logger.warn).toHaveBeenCalledWith(
    { capability: whatsappCapability('UNKNOWN_SETUP_ERROR') },
    'staff OTP capability',
  );
  expect(loggedArgs()).not.toContain('SYNTHETIC_UNKNOWN_SETUP_FAILURE');
});

it('password reset stays closed in production without a trusted proxy and opens with one', async () => {
  const { startPasswordReset } = await import('../../password-reset-startup.ts');
  const shared = {
    env: {
      NOTIFICATION_EMAIL_HASH_KEY: 'synthetic-email'.repeat(6),
      NOTIFICATION_EMAIL_HASH_KEY_ID: 'synthetic-e',
    },
    redis: {} as never,
    redisUrl: 'synthetic',
    ids: {} as never,
    service: { hashPassword: vi.fn() },
    logger: resources.logger as never,
    production: true,
  };
  expect(startPasswordReset({ ...shared, trustedProxy: [] })).toBeNull();
  expect(resources.passwordReset).not.toHaveBeenCalled();
  expect(resources.logger.info).toHaveBeenCalledWith(
    {
      capability: {
        name: 'PASSWORD_RESET_OTP',
        state: 'UNAVAILABLE',
        reason: 'NO_TRUSTED_PROXY',
      },
    },
    'password reset capability',
  );
  startPasswordReset({ ...shared, trustedProxy: ['127.0.0.1/32'] });
  expect(resources.passwordReset).toHaveBeenCalledOnce();
  startPasswordReset({ ...shared, production: false, trustedProxy: [] });
  expect(resources.passwordReset).toHaveBeenCalledTimes(2);
});

it('wires trimmed staff POS and native origins from env into createApp and passkeyPolicy (#666)', async () => {
  resources.configOverrides = {
    BETTER_AUTH_URL: 'http://localhost:3000',
    AUTH_TRUSTED_ORIGINS: ['http://localhost:5173'],
  };
  vi.stubEnv('STAFF_OTP_POS_ORIGIN', '  http://localhost:5173  ');
  vi.stubEnv('STAFF_NATIVE_ORIGINS', ' capacitor://localhost ');
  await import('../../main.ts');
  expect(resources.appOptions).toHaveBeenCalledWith(
    expect.objectContaining({
      personal: expect.objectContaining({ origin: 'http://localhost:5173' }),
      staff: expect.objectContaining({
        origin: 'http://localhost:5173',
        nativeOrigins: ['capacitor://localhost'],
      }),
    }),
  );
});
