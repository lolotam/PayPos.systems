import { describe, expect, it } from 'vitest';
import { readRatingTokenConfiguration } from './configuration.ts';

const K1 = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const K2 = '//79/Pv6+fj39vX08/Lx8O/u7ezr6uno5+bl5OPi4eA=';
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
    expect(JSON.stringify(configuration)).not.toContain(K1);
    expect(JSON.stringify(configuration)).not.toContain(K2);
  });

  it('uses a stable keyed fingerprint without exposing key text', () => {
    const first = readRatingTokenConfiguration(CURRENT_K2_WITH_RETIRED_K1);
    const second = readRatingTokenConfiguration(CURRENT_K2_WITH_RETIRED_K1);
    const different = readRatingTokenConfiguration({
      ...CURRENT_K2_WITH_RETIRED_K1,
      RATING_TOKEN_DERIVATION_KEY: Buffer.alloc(32, 99).toString('base64'),
    });
    if (first.state !== 'READY' || second.state !== 'READY' || different.state !== 'READY')
      throw new Error('SYNTHETIC_CONFIG_MISSING');
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.fingerprint).toHaveLength(16);
    expect(different.fingerprint).not.toBe(first.fingerprint);
    for (const configuration of [first, second, different]) {
      expect(configuration.fingerprint).not.toContain(K1);
      expect(configuration.fingerprint).not.toContain(K2);
      expect(JSON.stringify(configuration)).not.toContain(K1);
      expect(JSON.stringify(configuration)).not.toContain(K2);
    }
  });
});
