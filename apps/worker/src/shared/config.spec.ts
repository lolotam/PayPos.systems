import { expect, it } from 'vitest';
import { readConfig } from './config.ts';

const valid = {
  DATABASE_URL: 'postgres://synthetic:synthetic@127.0.0.1/synthetic',
  DISPATCHER_DATABASE_URL: 'postgres://synthetic:synthetic@127.0.0.1/synthetic',
  REDIS_URL: 'redis://127.0.0.1:6379',
};

it('empty optional core settings keep production startup on its defaults', () => {
  expect(
    readConfig({
      ...valid,
      NODE_ENV: 'production',
      WORKER_HOST: '',
      WORKER_PORT: '',
      LOG_LEVEL: '',
      PLATFORM_NOTIFICATIONS_DATABASE_URL: '',
      AUTH_DATABASE_URL: '',
      STAFF_OTP_ENABLED: '',
      NOTIFICATIONS_MODE: '',
    }),
  ).toMatchObject({
    WORKER_HOST: '127.0.0.1',
    WORKER_PORT: 3001,
    LOG_LEVEL: 'info',
    PLATFORM_NOTIFICATIONS_DATABASE_URL: undefined,
  });
});

it.each(['true', 'false'])('OTP=%s isolates invalid optional intake configuration', (enabled) => {
  expect(
    readConfig({
      ...valid,
      STAFF_OTP_ENABLED: enabled,
      PLATFORM_NOTIFICATIONS_DATABASE_URL: 'synthetic-invalid',
    }).PLATFORM_NOTIFICATIONS_DATABASE_URL,
  ).toBeUndefined();
  expect(
    readConfig({ ...valid, NODE_ENV: 'production', PLATFORM_NOTIFICATIONS_DATABASE_URL: '' })
      .PLATFORM_NOTIFICATIONS_DATABASE_URL,
  ).toBeUndefined();
});
