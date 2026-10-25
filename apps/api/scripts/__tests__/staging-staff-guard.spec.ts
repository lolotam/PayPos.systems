import { describe, expect, it } from 'vitest';

import { assertStagingTarget, OperatorInputError } from '../staging-staff-guard.ts';

const database = 'postgres://app@db.synthetic.internal:5432/pospay_synthetic';
const authDatabase = 'postgres://auth@db.synthetic.internal:5432/pospay_synthetic';
const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  DEPLOY_ENV: 'staging',
  BETTER_AUTH_URL: 'https://api.staging.pospay.systems',
  COOKIE_DOMAIN: '.staging.pospay.systems',
  DATABASE_URL: database,
  AUTH_DATABASE_URL: authDatabase,
};

describe('staging staff target guard', () => {
  it('accepts the complete staging marker set', () => {
    expect(() => assertStagingTarget('staging', env)).not.toThrow();
  });

  it.each([
    ['target', 'production', {}],
    ['DEPLOY_ENV', 'staging', { DEPLOY_ENV: 'production' }],
    ['a non-staging auth host', 'staging', { BETTER_AUTH_URL: 'https://api.pospay.systems' }],
    [
      'a look-alike auth host',
      'staging',
      { BETTER_AUTH_URL: 'https://api.staging.pospay.systems.evil.test' },
    ],
    ['an unparsable auth URL', 'staging', { BETTER_AUTH_URL: 'not a URL' }],
    ['cookie domain', 'staging', { COOKIE_DOMAIN: '.pospay.systems' }],
    [
      'database host',
      'staging',
      { AUTH_DATABASE_URL: 'postgres://auth@other.synthetic.internal:5432/pospay_synthetic' },
    ],
    [
      'database port',
      'staging',
      { AUTH_DATABASE_URL: 'postgres://auth@db.synthetic.internal:5433/pospay_synthetic' },
    ],
    [
      'database name',
      'staging',
      { AUTH_DATABASE_URL: 'postgres://auth@db.synthetic.internal:5432/other_synthetic' },
    ],
    ['an unparsable database URL', 'staging', { DATABASE_URL: 'not a URL' }],
    ['a missing deployment marker', 'staging', { DEPLOY_ENV: undefined }],
    ['a missing auth URL', 'staging', { BETTER_AUTH_URL: undefined }],
    ['a missing app database URL', 'staging', { DATABASE_URL: undefined }],
    ['a missing auth database URL', 'staging', { AUTH_DATABASE_URL: undefined }],
  ])('refuses %s', (_label, target, change) => {
    expect(() => assertStagingTarget(target, { ...env, ...change })).toThrow(OperatorInputError);
  });
});
