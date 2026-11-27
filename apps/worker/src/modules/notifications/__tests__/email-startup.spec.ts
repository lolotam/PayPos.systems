import { afterEach, expect, it, vi } from 'vitest';
import {
  createEmailIdentity,
  EMAIL_FEEDBACK_QUEUE,
  emailFeedbackJob,
  readEmailConfiguration,
} from '@pospay/notifications';
import type * as NotificationsPkg from '@pospay/notifications';
import { createLogger } from '@pospay/observability';

const runtimeMocks = vi.hoisted(() => ({
  processors: new Map<string, (job: { name?: string; data: unknown }) => Promise<void>>(),
  retrieve: vi.fn(),
  pending: vi.fn(),
  settle: vi.fn(async () => true),
  quarantine: vi.fn(async () => undefined),
  scheduleRetry: vi.fn(async () => undefined),
  tenantReconcile: vi.fn(async () => ({ ok: true as const, bound: true, recorded: true })),
  databasePing: vi.fn(async () => undefined),
  databaseWithGlobal: vi.fn(async () => [{ count: 0 }]),
}));

vi.mock('@pospay/db', () => ({
  createPlatformEmailDatabase: () => ({
    ping: runtimeMocks.databasePing,
    withGlobal: runtimeMocks.databaseWithGlobal,
    close: vi.fn(async () => undefined),
  }),
}));

vi.mock('@pospay/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof NotificationsPkg>()),
  createResendEmailRetriever: () => ({ retrieve: runtimeMocks.retrieve }),
}));

vi.mock('../persistence/drizzle-email-feedback-inbox.repository.ts', () => ({
  createEmailFeedbackInboxRepository: () => ({
    pending: runtimeMocks.pending,
    quarantine: runtimeMocks.quarantine,
    scheduleRetry: runtimeMocks.scheduleRetry,
    unconfirmed: vi.fn(async () => []),
    due: vi.fn(async () => []),
    confirmEnqueue: vi.fn(async () => undefined),
    clearPayloads: vi.fn(async () => 0),
    settle: runtimeMocks.settle,
  }),
  createEmailFeedbackTenantRepository: () => ({
    reconcile: runtimeMocks.tenantReconcile,
  }),
}));

vi.mock('bullmq', () => ({
  Queue: class {
    on = vi.fn();
    waitUntilReady = vi.fn(async () => undefined);
    upsertJobScheduler = vi.fn(async () => undefined);
    close = vi.fn(async () => undefined);
  },
  Worker: class {
    constructor(name: string, processor: (job: { name?: string; data: unknown }) => Promise<void>) {
      runtimeMocks.processors.set(name, processor);
    }
    on = vi.fn();
    waitUntilReady = vi.fn(async () => undefined);
    close = vi.fn(async () => undefined);
  },
}));

vi.mock('ioredis', () => ({
  Redis: class {
    on = vi.fn();
    disconnect = vi.fn();
  },
}));

import { startEmailCapability, type EmailActivation } from '../email-startup.module.ts';
import { createEmailModule } from '../email.module.ts';

afterEach(() => {
  runtimeMocks.processors.clear();
  vi.clearAllMocks();
});

const KEY = 'synthetic-email-key'.repeat(4);
const KEY_ID = 'synthetic-email';
const EMAIL = 'synthetic@example.invalid';
const options = {
  env: { NOTIFICATION_EMAIL_HASH_KEY: KEY, NOTIFICATION_EMAIL_HASH_KEY_ID: KEY_ID },
  production: true,
  clock: { now: () => new Date('2026-10-03T10:00:00Z') },
  ids: { newId: () => '01920000-0000-7000-8000-00000000ea01' },
  logger: createLogger('info', { destination: { write: () => undefined } }),
};
const completeEnv = {
  NOTIFICATION_EMAIL_HASH_KEY: KEY,
  NOTIFICATION_EMAIL_HASH_KEY_ID: KEY_ID,
  RESEND_API_KEY: 'synthetic-test-only',
  EMAIL_FROM_ADDRESS: 'synthetic@send.pospay.systems',
  EMAIL_FROM_NAME: 'Synthetic sender',
  EMAIL_REPLY_TO: 'synthetic.replies@example.invalid',
  EMAIL_ADMIN_ORIGIN: 'https://app.pospay.systems',
  PLATFORM_NOTIFICATIONS_DATABASE_URL:
    'postgres://pospay_notifications:synthetic@127.0.0.1:5432/pospay',
};
const complete = readEmailConfiguration(completeEnv);

it('empty settings stay disabled and closing drops email identity and fences authorization', async () => {
  const empty = await startEmailCapability({ ...options, env: {} });
  expect(empty.module.capability.enabled).toBe(false);
  await empty.close();
  const capability = await startEmailCapability(options);
  const identity = createEmailIdentity(KEY, KEY_ID).identify(EMAIL);
  expect(capability.module.matches(EMAIL, identity)).toBe(true);
  await capability.close();
  expect(capability.module.matches(EMAIL, identity)).toBe(false);
  const args = [] as unknown as Parameters<typeof capability.module.authorize>;
  await expect(capability.module.authorize(...args)).rejects.toThrow('EMAIL_CAPABILITY_CLOSED');
});

it('a missing feedback database keeps the channel off with its own reason', async () => {
  const capability = await startEmailCapability({
    ...options,
    env: { ...completeEnv, PLATFORM_NOTIFICATIONS_DATABASE_URL: '' },
  });
  expect(capability.module.capability).toMatchObject({
    enabled: false,
    reason: 'EMAIL_FEEDBACK_DB_MISSING',
  });
  await capability.close();
});

it('an activated channel reports itself ready and closes back to the safe fallback', async () => {
  const activation: EmailActivation = {
    module: createEmailModule({ ...options, configuration: complete }),
    close: async () => undefined,
    quarantinedCount: 3,
  };
  const capability = await startEmailCapability(options, async () => activation);
  expect(capability.module.capability).toMatchObject({ enabled: true, reason: null });
  await capability.close();
  expect(capability.module.capability.enabled).toBe(false);
});

it('a failed initialization closes the channel with the feedback reason', async () => {
  const capability = await startEmailCapability({ ...options, env: completeEnv }, async () => {
    throw new Error('SYNTHETIC_SETUP_FAILED');
  });
  expect(capability.module.capability).toMatchObject({
    enabled: false,
    reason: 'EMAIL_FEEDBACK_UNAVAILABLE',
  });
  await capability.close();
});

it('hung initialization is bounded and a late result cannot reactivate a closed capability', async () => {
  vi.useFakeTimers();
  try {
    let resolveLate: (activation: EmailActivation) => void = () => undefined;
    const pending = startEmailCapability(
      options,
      () =>
        new Promise((resolve) => {
          resolveLate = resolve;
        }),
    );
    await vi.advanceTimersByTimeAsync(1001);
    const capability = await pending;
    expect(capability.module.capability.enabled).toBe(false);
    await capability.close();
    resolveLate({
      module: createEmailModule({
        ...options,
        configuration: {
          enabled: false,
          reason: 'RESEND_API_KEY_MISSING',
          hashKey: KEY,
          hashKeyId: KEY_ID,
        },
      }),
      close: async () => undefined,
      quarantinedCount: 0,
    });
    await Promise.resolve();
    expect(capability.module.matches(EMAIL, createEmailIdentity(KEY, KEY_ID).identify(EMAIL))).toBe(
      false,
    );
  } finally {
    vi.useRealTimers();
  }
});

function queueInboxJob(
  inboxId: string,
  providerEmailId: string,
  tags: Record<string, string | null>,
) {
  runtimeMocks.pending.mockResolvedValueOnce({
    id: inboxId,
    providerEmailId,
    feedbackType: 'email.delivered',
    bounceClass: null,
    providerTimestamp: new Date('2026-10-03T10:00:00Z'),
    providerEventDigest: Uint8Array.from([1, 2, 3]),
    attempts: 0,
  });
  runtimeMocks.retrieve.mockResolvedValueOnce({
    kind: 'found',
    id: providerEmailId,
    tags,
    recipientHash: createEmailIdentity(KEY, KEY_ID).identify(EMAIL).hash,
    hashKeyId: KEY_ID,
  });
}

it('activates email capability without NOTIFICATION_MESSAGE_ID_HASH_KEY and quarantines auth feedback as EXECUTION_MISSING', async () => {
  const logs: Record<string, unknown>[] = [];
  const authReconciler = {
    reconcileAuthAttempt: vi.fn(async () => ({ kind: 'settled' as const })),
  };
  const tenantInboxId = '01920000-0000-7000-8000-00000000ea10';
  const authInboxId = '01920000-0000-7000-8000-00000000ea11';
  const capability = await startEmailCapability({
    ...options,
    env: completeEnv,
    logger: createLogger('info', {
      destination: {
        write: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>),
      },
    }),
    appDatabase: { withTenant: vi.fn() },
    redisUrl: 'redis://synthetic:6379',
    authReconciler,
  });

  try {
    expect(capability.module.capability).toEqual({ enabled: true, reason: null });
    expect(logs).toContainEqual(
      expect.objectContaining({
        capability: expect.objectContaining({ channel: 'email', name: 'EMAIL', state: 'READY' }),
      }),
    );
    const processor = runtimeMocks.processors.get(EMAIL_FEEDBACK_QUEUE);
    expect(processor).toBeDefined();

    queueInboxJob(tenantInboxId, 'provider-tenant-1', {
      companyId: '01920000-0000-7000-8000-00000000eb01',
      authChallengeId: null,
      attemptId: '01920000-0000-7000-8000-00000000ec01',
      executionId: '01920000-0000-7000-8000-00000000ed01',
    });
    await processor?.(emailFeedbackJob(tenantInboxId));
    expect(runtimeMocks.tenantReconcile).toHaveBeenCalledOnce();
    expect(runtimeMocks.settle).toHaveBeenCalledOnce();

    queueInboxJob(authInboxId, 'provider-auth-1', {
      companyId: null,
      authChallengeId: '01920000-0000-7000-8000-00000000ee01',
      attemptId: '01920000-0000-7000-8000-00000000ec02',
      executionId: '01920000-0000-7000-8000-00000000ed02',
    });
    await processor?.(emailFeedbackJob(authInboxId));
    expect(authReconciler.reconcileAuthAttempt).not.toHaveBeenCalled();
    expect(runtimeMocks.quarantine).toHaveBeenCalledWith(
      authInboxId,
      'EXECUTION_MISSING',
      expect.any(Date),
    );
    expect(runtimeMocks.settle).toHaveBeenCalledOnce();
  } finally {
    await capability.close();
  }
});

it('reconciles auth feedback once NOTIFICATION_MESSAGE_ID_HASH_KEY is configured', async () => {
  const authReconciler = {
    reconcileAuthAttempt: vi.fn(async () => ({ kind: 'settled' as const })),
  };
  const authInboxId = '01920000-0000-7000-8000-00000000ea12';
  const capability = await startEmailCapability({
    ...options,
    env: { ...completeEnv, NOTIFICATION_MESSAGE_ID_HASH_KEY: 'synthetic-msg-key'.repeat(3) },
    appDatabase: { withTenant: vi.fn() },
    redisUrl: 'redis://synthetic:6379',
    authReconciler,
  });

  try {
    expect(capability.module.capability).toEqual({ enabled: true, reason: null });
    const processor = runtimeMocks.processors.get(EMAIL_FEEDBACK_QUEUE);
    queueInboxJob(authInboxId, 'provider-auth-2', {
      companyId: null,
      authChallengeId: '01920000-0000-7000-8000-00000000ee02',
      attemptId: '01920000-0000-7000-8000-00000000ec03',
      executionId: '01920000-0000-7000-8000-00000000ed03',
    });
    await processor?.(emailFeedbackJob(authInboxId));
    expect(authReconciler.reconcileAuthAttempt).toHaveBeenCalledOnce();
    expect(runtimeMocks.quarantine).not.toHaveBeenCalled();
    expect(runtimeMocks.settle).toHaveBeenCalledOnce();
  } finally {
    await capability.close();
  }
});
