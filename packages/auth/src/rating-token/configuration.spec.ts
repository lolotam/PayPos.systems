import { describe, expect, it } from 'vitest';
import { readRatingTokenConfiguration } from './configuration.ts';

const K1 = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const K2 = '//79/Pv6+fj39vX08/Lx8O/u7ezr6uno5+bl5OPi4eA=';
const ASCII_SECRET = 'abcdefghijklmnopqrstuvwxyz012345';
const ASCII_SECRET_B64 = Buffer.from(ASCII_SECRET, 'utf8').toString('base64');
const CURRENT_K1 = {
  RATING_TOKEN_DERIVATION_KEY: K1,
  RATING_TOKEN_DERIVATION_KEY_VERSION: '1',
};
const CURRENT_K2_WITH_RETIRED_K1 = {
  RATING_TOKEN_DERIVATION_KEY: K2,
  RATING_TOKEN_DERIVATION_KEY_VERSION: '2',
  RATING_TOKEN_DERIVATION_RETIRED_KEYS: JSON.stringify({ '1': K1 }),
};

interface ConfigurationCase {
  readonly name: string;
  readonly env: NodeJS.ProcessEnv;
  readonly expectedState: 'DISABLED' | 'UNAVAILABLE' | 'READY';
  readonly currentVersion?: number;
  readonly versions?: readonly number[];
}

const cases: ConfigurationCase[] = [
  { name: 'is disabled when all settings are absent', env: {}, expectedState: 'DISABLED' },
  {
    name: 'is disabled when all settings are empty',
    env: {
      RATING_TOKEN_DERIVATION_KEY: '',
      RATING_TOKEN_DERIVATION_KEY_VERSION: '',
      RATING_TOKEN_DERIVATION_RETIRED_KEYS: '',
    },
    expectedState: 'DISABLED',
  },
  {
    name: 'reads the current K1 configuration',
    env: CURRENT_K1,
    expectedState: 'READY',
    currentVersion: 1,
    versions: [1],
  },
  {
    name: 'reads current K2 with retired K1',
    env: CURRENT_K2_WITH_RETIRED_K1,
    expectedState: 'READY',
    currentVersion: 2,
    versions: [1, 2],
  },
  {
    name: 'rejects a key without a version',
    env: { RATING_TOKEN_DERIVATION_KEY: K1 },
    expectedState: 'UNAVAILABLE',
  },
  {
    name: 'rejects a version without a key',
    env: { RATING_TOKEN_DERIVATION_KEY_VERSION: '1' },
    expectedState: 'UNAVAILABLE',
  },
  {
    name: 'rejects a 31-byte key',
    env: { ...CURRENT_K1, RATING_TOKEN_DERIVATION_KEY: Buffer.alloc(31, 1).toString('base64') },
    expectedState: 'UNAVAILABLE',
  },
  {
    name: 'rejects non-canonical base64',
    env: { ...CURRENT_K1, RATING_TOKEN_DERIVATION_KEY: K1.replace(/=$/, '') },
    expectedState: 'UNAVAILABLE',
  },
  {
    name: 'rejects version zero',
    env: { ...CURRENT_K1, RATING_TOKEN_DERIVATION_KEY_VERSION: '0' },
    expectedState: 'UNAVAILABLE',
  },
  {
    name: 'rejects version 32768',
    env: { ...CURRENT_K1, RATING_TOKEN_DERIVATION_KEY_VERSION: '32768' },
    expectedState: 'UNAVAILABLE',
  },
  {
    name: 'rejects a zero-padded version',
    env: { ...CURRENT_K1, RATING_TOKEN_DERIVATION_KEY_VERSION: '01' },
    expectedState: 'UNAVAILABLE',
  },
  {
    name: 'rejects an array of retired keys',
    env: { ...CURRENT_K1, RATING_TOKEN_DERIVATION_RETIRED_KEYS: '[]' },
    expectedState: 'UNAVAILABLE',
  },
  {
    name: 'rejects retirement of the current version',
    env: {
      ...CURRENT_K1,
      RATING_TOKEN_DERIVATION_RETIRED_KEYS: JSON.stringify({ '1': K2 }),
    },
    expectedState: 'UNAVAILABLE',
  },
  {
    name: 'rejects identical key bytes under two versions',
    env: {
      ...CURRENT_K1,
      RATING_TOKEN_DERIVATION_RETIRED_KEYS: JSON.stringify({ '2': K1 }),
    },
    expectedState: 'UNAVAILABLE',
  },
  {
    name: 'rejects a duplicated retired version',
    env: {
      ...CURRENT_K1,
      RATING_TOKEN_DERIVATION_RETIRED_KEYS: `{"2":"${K2}","2":"${Buffer.alloc(32, 7).toString('base64')}"}`,
    },
    expectedState: 'UNAVAILABLE',
  },
  {
    name: 'rejects a current key reused from staff OTP derivation',
    env: { ...CURRENT_K1, STAFF_OTP_DERIVATION_KEY: K1 },
    expectedState: 'UNAVAILABLE',
  },
  {
    name: 'rejects a retired key reused from notification phone hashing',
    env: { ...CURRENT_K2_WITH_RETIRED_K1, NOTIFICATION_PHONE_HASH_KEY: K1 },
    expectedState: 'UNAVAILABLE',
  },
  {
    name: 'rejects a current key reused from retired staff OTP derivation keys',
    env: {
      ...CURRENT_K1,
      STAFF_OTP_DERIVATION_RETIRED_KEYS: JSON.stringify({ old: K1 }),
    },
    expectedState: 'UNAVAILABLE',
  },
  {
    name: 'rejects a retired rating key reused from retired staff OTP verification keys',
    env: {
      ...CURRENT_K2_WITH_RETIRED_K1,
      STAFF_OTP_VERIFICATION_RETIRED_KEYS: JSON.stringify({ old: K1 }),
    },
    expectedState: 'UNAVAILABLE',
  },
  {
    name: 'rejects a current key reused from notification email hashing',
    env: { ...CURRENT_K1, NOTIFICATION_EMAIL_HASH_KEY: K1 },
    expectedState: 'UNAVAILABLE',
  },
  {
    name: 'rejects malformed retired staff OTP derivation keys',
    env: { ...CURRENT_K1, STAFF_OTP_DERIVATION_RETIRED_KEYS: 'not json' },
    expectedState: 'UNAVAILABLE',
  },
  {
    name: 'allows an unrelated retired staff OTP derivation key',
    env: {
      ...CURRENT_K1,
      STAFF_OTP_DERIVATION_RETIRED_KEYS: JSON.stringify({ old: K2 }),
    },
    expectedState: 'READY',
    currentVersion: 1,
    versions: [1],
  },
  {
    name: 'rejects rating key bytes reused as raw notification text',
    env: {
      RATING_TOKEN_DERIVATION_KEY: ASCII_SECRET_B64,
      RATING_TOKEN_DERIVATION_KEY_VERSION: '1',
      NOTIFICATION_MESSAGE_ID_HASH_KEY: ASCII_SECRET,
    },
    expectedState: 'UNAVAILABLE',
  },
];

describe('rating token configuration', () => {
  it.each(cases)('$name', (testCase) => {
    const configuration = readRatingTokenConfiguration(testCase.env);
    expect(configuration.state).toBe(testCase.expectedState);
    if (testCase.expectedState === 'READY') {
      if (configuration.state !== 'READY') throw new Error('SYNTHETIC_CONFIG_MISSING');
      expect(configuration.ring.currentVersion).toBe(testCase.currentVersion);
      expect([...configuration.ring.keys.keys()].sort((a, b) => a - b)).toEqual(testCase.versions);
    }
  });

  it('uses a stable keyed fingerprint without exposing key text', () => {
    const first = readRatingTokenConfiguration(CURRENT_K2_WITH_RETIRED_K1);
    const second = readRatingTokenConfiguration(CURRENT_K2_WITH_RETIRED_K1);
    const single = readRatingTokenConfiguration(CURRENT_K1);
    const different = readRatingTokenConfiguration({
      ...CURRENT_K2_WITH_RETIRED_K1,
      RATING_TOKEN_DERIVATION_KEY: Buffer.alloc(32, 99).toString('base64'),
    });
    if (
      first.state !== 'READY' ||
      second.state !== 'READY' ||
      single.state !== 'READY' ||
      different.state !== 'READY'
    )
      throw new Error('SYNTHETIC_CONFIG_MISSING');
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.fingerprint).toBe('252fc195628dde32');
    expect(single.fingerprint).toBe('efe2c55902d17be9');
    expect(first.fingerprint).toHaveLength(16);
    expect(different.fingerprint).not.toBe(first.fingerprint);
    for (const configuration of [first, second, single, different]) {
      expect(configuration.fingerprint).not.toContain(K1);
      expect(configuration.fingerprint).not.toContain(K2);
    }
  });

  it('changes the fingerprint when only the current version changes', () => {
    const currentTwo = readRatingTokenConfiguration(CURRENT_K2_WITH_RETIRED_K1);
    const currentOne = readRatingTokenConfiguration({
      RATING_TOKEN_DERIVATION_KEY: K1,
      RATING_TOKEN_DERIVATION_KEY_VERSION: '1',
      RATING_TOKEN_DERIVATION_RETIRED_KEYS: JSON.stringify({ '2': K2 }),
    });
    if (currentTwo.state !== 'READY' || currentOne.state !== 'READY')
      throw new Error('SYNTHETIC_CONFIG_MISSING');
    expect(currentTwo.fingerprint).toBe('252fc195628dde32');
    expect(currentOne.fingerprint).toBe('9eb178a028eebab3');
    expect(currentOne.fingerprint).not.toBe(currentTwo.fingerprint);
  });
});
