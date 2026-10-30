import { expect, it, vi } from 'vitest';
import type { Logger } from '@pospay/observability';
import { reportRatingTokenCapability } from './rating-token-capability.ts';

const K1 = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';

it.each([
  {
    name: 'reports DISABLED when rating tokens are not configured',
    env: {},
    expectedLevel: 'info',
    expected: {
      capability: { name: 'RATING_TOKENS', state: 'DISABLED', reason: 'NOT_CONFIGURED' },
    },
  },
  {
    name: 'reports UNAVAILABLE when the key has no version',
    env: { RATING_TOKEN_DERIVATION_KEY: K1 },
    expectedLevel: 'warn',
    expected: {
      capability: { name: 'RATING_TOKENS', state: 'UNAVAILABLE', reason: 'CONFIGURATION_INVALID' },
    },
  },
  {
    name: 'reports READY with the keyed fingerprint',
    env: { RATING_TOKEN_DERIVATION_KEY: K1, RATING_TOKEN_DERIVATION_KEY_VERSION: '1' },
    expectedLevel: 'info',
    expected: {
      capability: {
        name: 'RATING_TOKENS',
        state: 'READY',
        fingerprint: 'efe2c55902d17be9',
      },
    },
  },
])('$name', ({ env, expected, expectedLevel }) => {
  const info = vi.fn();
  const warn = vi.fn();
  const logger = { info, warn } as unknown as Logger;
  reportRatingTokenCapability(env, logger);
  const expectedMock = expectedLevel === 'info' ? info : warn;
  const otherMock = expectedLevel === 'info' ? warn : info;
  expect(expectedMock).toHaveBeenCalledWith(expected, 'rating token capability');
  expect(expectedMock).toHaveBeenCalledTimes(1);
  expect(otherMock).not.toHaveBeenCalled();
  expect(JSON.stringify(info.mock.calls)).not.toContain(K1);
  expect(JSON.stringify(warn.mock.calls)).not.toContain(K1);
});
