import { expect, it, vi } from 'vitest';
import { createEmailIdentity, readEmailConfiguration } from '@pospay/notifications';
import { createLogger } from '@pospay/observability';
import { startEmailCapability, type EmailActivation } from '../email-startup.module.ts';
import { createEmailModule } from '../email.module.ts';

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
  const capability = await startEmailCapability(
    { ...options, env: completeEnv },
    async () => {
      throw new Error('SYNTHETIC_SETUP_FAILED');
    },
  );
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
