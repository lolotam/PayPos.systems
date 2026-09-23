import { describe, expect, it } from 'vitest';

import { readConfig } from '../config.ts';

const valid = {
  DATABASE_URL: 'postgres://pospay_app:s3cret-pass@127.0.0.1:5432/pospay',
  REDIS_URL: 'redis://:r3dis-pass@127.0.0.1:6379',
};

describe('readConfig', () => {
  it('applies defaults', () => {
    expect(readConfig(valid)).toMatchObject({ API_PORT: 3000, LOG_LEVEL: 'info' });
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
