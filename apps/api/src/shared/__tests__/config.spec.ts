import { describe, expect, it } from 'vitest';

import { readConfig } from '../config.ts';

const valid = {
  DATABASE_URL: 'postgres://pospay_app:s3cret-pass@127.0.0.1:5432/pospay',
  REDIS_URL: 'redis://:r3dis-pass@127.0.0.1:6379',
  AUTH_DATABASE_URL: 'postgres://pospay_auth:auth-pass@127.0.0.1:5432/pospay',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://127.0.0.1:3000',
};

describe('readConfig', () => {
  it('applies defaults', () => {
    expect(readConfig(valid)).toMatchObject({
      API_PORT: 3000,
      LOG_LEVEL: 'info',
      AUTH_TRUSTED_ORIGINS: [],
    });
  });

  it('splits the trusted origins and refuses a short auth secret without echoing it', () => {
    expect(
      readConfig({ ...valid, AUTH_TRUSTED_ORIGINS: 'https://admin.test, https://pos.test' })
        .AUTH_TRUSTED_ORIGINS,
    ).toEqual(['https://admin.test', 'https://pos.test']);
    const attempt = () => readConfig({ ...valid, BETTER_AUTH_SECRET: 'short-secret-leak' });
    expect(attempt).toThrow(/BETTER_AUTH_SECRET/);
    expect(attempt).not.toThrow(/short-secret-leak/);
  });

  it('names the invalid keys but never echoes a value', () => {
    const attempt = () =>
      readConfig({
        ...valid,
        DATABASE_URL: 'mysql://leaked-password@x',
        LOG_LEVEL: 'hunter2secret',
      });
    expect(attempt).toThrow(/DATABASE_URL/);
    expect(attempt).toThrow(/LOG_LEVEL/);
    try {
      attempt();
    } catch (error) {
      expect(String(error)).not.toContain('leaked-password');
      expect(String(error)).not.toContain('hunter2secret');
    }
  });
});
