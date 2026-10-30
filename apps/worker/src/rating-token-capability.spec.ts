import { expect, it, vi } from 'vitest';
import type { Logger } from '@pospay/observability';
import { reportRatingTokenCapability } from './rating-token-capability.ts';

const K1 = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';

it.each([
  {
    name: 'reports DISABLED when rating tokens are not configured',
    env: {},
    expected: {
      capability: { name: 'RATING_TOKENS', state: 'DISABLED', reason: 'NOT_CONFIGURED' },
    },
  },
  {
    name: 'reports UNAVAILABLE when the key has no version',
    env: { RATING_TOKEN_DERIVATION_KEY: K1 },
    expected: {
      capability: { name: 'RATING_TOKENS', state: 'UNAVAILABLE', reason: 'CONFIGURATION_INVALID' },
    },
  },
  {
    name: 'reports READY with the keyed fingerprint',
    env: { RATING_TOKEN_DERIVATION_KEY: K1, RATING_TOKEN_DERIVATION_KEY_VERSION: '1' },
    expected: {
      capability: {
        name: 'RATING_TOKENS',
        state: 'READY',
        fingerprint: 'efe2c55902d17be9',
      },
    },
  },
])('$name', ({ env, expected }) => {
  const info = vi.fn();
  const logger = { info } as unknown as Logger;
  reportRatingTokenCapability(env, logger);
  expect(info).toHaveBeenCalledWith(expected, 'rating token capability');
  expect(info).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(info.mock.calls)).not.toContain(K1);
});
