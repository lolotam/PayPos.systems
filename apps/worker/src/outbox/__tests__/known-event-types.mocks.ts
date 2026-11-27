import { vi } from 'vitest';

export type RegisteredStartup = {
  consumers: { id: string; eventTypes: readonly string[] }[];
  known: readonly string[];
};

export const noop = () => undefined;
export const asyncNoop = async () => undefined;

class StubRedis {
  duplicate = () => new StubRedis();
  on = noop;
  quit = noop;
  disconnect = noop;
  ping = noop;
  set = noop;
  del = noop;
  get = noop;
  evalsha = noop;
}

class StubBull {
  on = noop;
  waitUntilReady = asyncNoop;
  close = asyncNoop;
}

function packageMockFactories(): readonly [string, () => Record<string, unknown>][] {
  const closed = () => ({ readiness: noop, stop: noop, close: noop });
  return [
    [
      '@pospay/db',
      () => ({
        createDatabase: () => ({ close: asyncNoop, ping: asyncNoop, withTenant: vi.fn() }),
        createOutboxDispatcherDatabase: () => ({
          close: asyncNoop,
          ping: asyncNoop,
          commissionParkedEventPage: async () => [],
        }),
        createPlatformWhatsappDatabase: () => ({ close: asyncNoop, ping: asyncNoop }),
      }),
    ],
    [
      '@pospay/auth',
      () => ({
        createStaffOtpExecution: () => ({ readiness: noop, close: noop }),
        createStaffOtpMaintenance: closed,
        readStaffOtpConfiguration: () => ({ state: 'DISABLED', fingerprint: 'synthetic-worker' }),
      }),
    ],
    [
      '@pospay/observability',
      () => ({
        createLogger: () => ({ info: noop, warn: noop, fatal: noop, error: noop, debug: noop }),
      }),
    ],
    ['ioredis', () => ({ Redis: StubRedis })],
    ['bullmq', () => ({ Queue: StubBull, Worker: StubBull })],
  ];
}

function moduleMockFactories(
  registered: RegisteredStartup[],
): readonly [string, () => Record<string, unknown>][] {
  return [
    [
      '../../worker.ts',
      () => ({ createWorker: async () => ({ listen: noop, enableShutdownHooks: noop }) }),
    ],
    ['../dispatch-loop.ts', () => ({ createDispatchLoop: () => ({ start: noop, stop: noop }) })],
    [
      '../deliver.ts',
      () => ({
        createDeliverer: (
          _app: unknown,
          consumers: { id: string; eventTypes: readonly string[] }[],
          _logger: unknown,
          { knownEventTypes }: { knownEventTypes: readonly string[] },
        ) => {
          registered.push({ consumers: [...consumers], known: knownEventTypes });
          return async () => ({ delivered: true });
        },
      }),
    ],
    [
      '../../modules/files/index.ts',
      () => ({
        startFilesWorker: () => ({
          consumer: { id: 'files.business-logo-retired', eventTypes: ['BusinessLogoChanged'] },
          deliver: noop,
          close: noop,
        }),
      }),
    ],
  ];
}

function runtimeMockFactories(): readonly [string, () => Record<string, unknown>][] {
  const closed = () => ({ readiness: noop, stop: noop, close: noop });
  const delivery = (event: unknown, next: (event: unknown) => Promise<unknown>) => next(event);
  return [
    [
      '../../commission-reminders.ts',
      () => ({ startCommissionReminderWiring: () => ({ delivery, ...closed() }) }),
    ],
    [
      '../../documents/start-documents.ts',
      () => ({
        startCoreBeforeDocuments: async (input: { startCore: () => Promise<void> }) => {
          await input.startCore();
          return { started: Promise.resolve(), close: asyncNoop, stop: asyncNoop };
        },
      }),
    ],
    [
      '../../shared/config.ts',
      () => ({
        readConfig: () => ({
          DATABASE_URL: 'synthetic',
          DISPATCHER_DATABASE_URL: 'synthetic',
          REDIS_URL: 'synthetic',
          PLATFORM_NOTIFICATIONS_DATABASE_URL: 'synthetic',
          LOG_LEVEL: 'silent',
          WORKER_HOST: '127.0.0.1',
          WORKER_PORT: 3001,
          PACKAGE_SALE_TRANSACTION_TIMEOUT_MS: 30_000,
          PACKAGE_IMPORT_COMMIT_TRANSACTION_TIMEOUT_MS: 600_000,
        }),
      }),
    ],
  ];
}

export function startupMockFactories(
  registered: RegisteredStartup[],
): readonly [string, () => Record<string, unknown>][] {
  return [...packageMockFactories(), ...moduleMockFactories(registered), ...runtimeMockFactories()];
}
