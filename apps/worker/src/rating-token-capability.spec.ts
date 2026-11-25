import { expect, it, vi } from 'vitest';
import type { Logger } from '@pospay/observability';
import { createRatingTokenSender, reportRatingTokenCapability } from './rating-token-capability.ts';

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

const K2 = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=';
const IDENTITY = {
  companyId: '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b',
  ratingRequestId: '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2c',
};

it('createRatingTokenSender is null unless the ring is READY', () => {
  expect(createRatingTokenSender({})).toBeNull();
  expect(createRatingTokenSender({ RATING_TOKEN_DERIVATION_KEY: K1 })).toBeNull();
});

it('createRatingTokenSender derives for the current and retired versions only', () => {
  const sender = createRatingTokenSender({
    RATING_TOKEN_DERIVATION_KEY: K2,
    RATING_TOKEN_DERIVATION_KEY_VERSION: '2',
    RATING_TOKEN_DERIVATION_RETIRED_KEYS: JSON.stringify({ '1': K1 }),
  });
  const current = sender?.token(IDENTITY, 2);
  const retired = sender?.token(IDENTITY, 1);
  expect(typeof current).toBe('string');
  expect(typeof retired).toBe('string');
  expect(current).not.toBe(retired);
  expect(sender?.token(IDENTITY, 99)).toBeNull();
});
