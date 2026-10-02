import { expect, it } from 'vitest';
import { readConfig } from './config.ts';

const valid = {
  DATABASE_URL: 'postgres://synthetic:synthetic@127.0.0.1/synthetic',
  DISPATCHER_DATABASE_URL: 'postgres://synthetic:synthetic@127.0.0.1/synthetic',
  REDIS_URL: 'redis://127.0.0.1:6379',
};

it.each(['true', 'false'])('OTP=%s does not bypass intake configuration validation', (enabled) => {
  expect(() =>
    readConfig({
      ...valid,
      STAFF_OTP_ENABLED: enabled,
      PLATFORM_NOTIFICATIONS_DATABASE_URL: 'synthetic-invalid',
    }),
  ).toThrow(/PLATFORM_NOTIFICATIONS_DATABASE_URL/);
  expect(
    readConfig({ ...valid, NODE_ENV: 'production', PLATFORM_NOTIFICATIONS_DATABASE_URL: '' })
      .PLATFORM_NOTIFICATIONS_DATABASE_URL,
  ).toBeUndefined();
});
