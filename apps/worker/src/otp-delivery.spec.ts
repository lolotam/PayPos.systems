import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';

const hoisted = vi.hoisted(() => ({
  startWorker: vi.fn(),
  execution: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock('./modules/notifications/index.ts', () => ({ startStaffOtpWorker: hoisted.startWorker }));
vi.mock('@pospay/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createStaffOtpExecution: hoisted.execution,
}));

import { createOtpDelivery, type OtpDeliveryInput } from './otp-delivery.ts';

const KEY = 'synthetic-hash-key-synthetic-hash-key';
const EMAIL_ENV = {
  AUTH_DATABASE_URL: 'postgres://synthetic',
  REDIS_URL: 'redis://synthetic',
  PLATFORM_NOTIFICATIONS_DATABASE_URL: 'postgres://synthetic',
  NOTIFICATION_EMAIL_HASH_KEY: KEY,
  NOTIFICATION_EMAIL_HASH_KEY_ID: 'email-v1',
  NOTIFICATION_MESSAGE_ID_HASH_KEY: KEY,
  RESEND_API_KEY: 'synthetic-api-key',
  EMAIL_FROM_ADDRESS: 'no-reply@send.pospay.systems',
  EMAIL_FROM_NAME: 'PosPay',
  EMAIL_REPLY_TO: 'support@pospay.systems',
  EMAIL_ADMIN_ORIGIN: 'https://app.staging.pospay.systems',
  STAFF_OTP_DERIVATION_KEY: Buffer.alloc(32, 17).toString('base64'),
  STAFF_OTP_DERIVATION_KEY_ID: 'synthetic-d',
  STAFF_OTP_VERIFICATION_KEY: Buffer.alloc(32, 29).toString('base64'),
  STAFF_OTP_VERIFICATION_KEY_ID: 'synthetic-v',
} satisfies NodeJS.ProcessEnv;

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function redisFake() {
  return {
    ping: vi.fn(async () => 'PONG'),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
  };
}

function input(
  env: NodeJS.ProcessEnv,
  redis = redisFake(),
): OtpDeliveryInput & { fake: typeof redis } {
  return {
    env,
    logger: logger as unknown as OtpDeliveryInput['logger'],
    redis: redis as unknown as Redis,
    redisUrl: 'redis://synthetic',
    stopping: () => false,
    fake: redis,
  };
}

async function stop(state: Awaited<ReturnType<ReturnType<typeof createOtpDelivery>['start']>>) {
  clearInterval(state.timer);
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.reconcile.mockResolvedValue({ kind: 'settled' });
  hoisted.execution.mockReturnValue({
    readiness: vi.fn(async () => undefined),
    reconcileAuthAttempt: hoisted.reconcile,
    close: vi.fn(async () => undefined),
  });
  hoisted.startWorker.mockReturnValue({
    ready: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  });
});

describe('the reserved OTP worker serves the email channel on its own', () => {
  it('starts with WhatsApp disabled and publishes only the email fingerprint', async () => {
    const received = input(EMAIL_ENV);
    const delivery = createOtpDelivery(received);
    const state = await delivery.start(undefined);
    try {
      expect(state.otp).toBeDefined();
      const options = hoisted.startWorker.mock.calls[0]?.[0];
      expect(options.whatsappCapability).toBeUndefined();
      expect(options.emailCapability).toBeDefined();
      expect(received.fake.set).toHaveBeenCalledWith(
        'email-otp:worker-capability',
        expect.any(String),
        'PX',
        3000,
      );
      expect(received.fake.del).toHaveBeenCalledWith('staff-otp:worker-capability');
      expect(received.fake.set).not.toHaveBeenCalledWith(
        'staff-otp:worker-capability',
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    } finally {
      await stop(state);
    }
  });

  it('does not start, build the identity connection or publish anything with no usable channel', async () => {
    const received = input({});
    const delivery = createOtpDelivery(received);
    const state = await delivery.start(undefined);
    expect(state.otp).toBeUndefined();
    expect(hoisted.startWorker).not.toHaveBeenCalled();
    expect(hoisted.execution).not.toHaveBeenCalled();
    expect(delivery.auth).toBeUndefined();
    expect(received.fake.set).not.toHaveBeenCalled();
  });

  it('stays down for email when the keys are incomplete, without throwing at construction', async () => {
    const env = { ...EMAIL_ENV, NOTIFICATION_EMAIL_HASH_KEY: '' };
    const delivery = createOtpDelivery(input(env));
    const state = await delivery.start(undefined);
    expect(state.otp).toBeUndefined();
    expect(hoisted.startWorker).not.toHaveBeenCalled();
  });
});

describe('the identity interface behind the provider reply', () => {
  it('fails retryably, not with a permanent refusal, before the identity interface exists', async () => {
    const delivery = createOtpDelivery(input({}));
    await expect(
      delivery.reconciler.reconcileAuthAttempt({
        challengeId: 'c',
        attemptId: 'a',
        executionId: 'e',
        recipientHash: new Uint8Array(32),
        hashKeyId: 'email-v1',
        providerMessageDigest: new Uint8Array(32),
      }),
    ).rejects.toThrow('AUTH_EXECUTION_NOT_READY');
    expect(hoisted.reconcile).not.toHaveBeenCalled();
  });

  it('hands the provider reply to the identity interface once a channel is running', async () => {
    const delivery = createOtpDelivery(input(EMAIL_ENV));
    const state = await delivery.start(undefined);
    try {
      const reply = {
        challengeId: 'c',
        attemptId: 'a',
        executionId: 'e',
        recipientHash: new Uint8Array(32),
        hashKeyId: 'email-v1',
        providerMessageDigest: new Uint8Array(32),
      };
      expect(await delivery.reconciler.reconcileAuthAttempt(reply)).toEqual({ kind: 'settled' });
      expect(hoisted.reconcile).toHaveBeenCalledWith(reply);
    } finally {
      await stop(state);
    }
  });

  it('gives the execution an email identity that fails closed when its key is unusable', async () => {
    const delivery = createOtpDelivery(input({ ...EMAIL_ENV, NOTIFICATION_PHONE_HASH_KEY: '' }));
    const state = await delivery.start(undefined);
    try {
      const strategies = hoisted.execution.mock.calls[0]?.[0].strategies;
      expect(strategies.identifyEmail('owner@example.invalid').valid).toBe(true);
      expect(strategies.identify('+99900000001').valid).toBe(false);
    } finally {
      await stop(state);
    }
  });
});
