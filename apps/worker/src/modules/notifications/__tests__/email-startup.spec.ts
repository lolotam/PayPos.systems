import { expect, it, vi } from 'vitest';
import { createEmailIdentity } from '@pospay/notifications';
import { createLogger } from '@pospay/observability';
import { startEmailCapability } from '../email-startup.module.ts';
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

it('hung initialization is bounded and a late result cannot reactivate a closed capability', async () => {
  vi.useFakeTimers();
  try {
    let resolveLate: (module: ReturnType<typeof createEmailModule>) => void = () => undefined;
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
    resolveLate(
      createEmailModule({
        ...options,
        configuration: {
          enabled: false,
          reason: 'EMAIL_FEEDBACK_NOT_IMPLEMENTED',
          hashKey: KEY,
          hashKeyId: KEY_ID,
        },
      }),
    );
    await Promise.resolve();
    expect(capability.module.matches(EMAIL, createEmailIdentity(KEY, KEY_ID).identify(EMAIL))).toBe(
      false,
    );
  } finally {
    vi.useRealTimers();
  }
});
