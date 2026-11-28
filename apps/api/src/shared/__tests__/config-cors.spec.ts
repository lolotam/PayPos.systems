import { describe, expect, it } from 'vitest';

import { corsOriginsFrom, readConfig } from '../config.ts';

const valid = {
  DATABASE_URL: 'postgres://pospay_app:s3cret-pass@127.0.0.1:5432/pospay',
  REDIS_URL: 'redis://:r3dis-pass@127.0.0.1:6379',
  AUTH_DATABASE_URL: 'postgres://pospay_auth:auth-pass@127.0.0.1:5432/pospay',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://127.0.0.1:3000',
};

describe('API_CORS_ORIGINS (#669)', () => {
  it('defaults corsOriginsFrom to AUTH_TRUSTED_ORIGINS when API_CORS_ORIGINS is unset or blank', () => {
    const cfg = readConfig({
      ...valid,
      AUTH_TRUSTED_ORIGINS: 'https://admin.example.test, https://pos.example.test',
    });
    expect(cfg.API_CORS_ORIGINS).toEqual([]);
    expect(corsOriginsFrom(cfg)).toEqual([
      'https://admin.example.test',
      'https://pos.example.test',
    ]);

    const blank = readConfig({
      ...valid,
      AUTH_TRUSTED_ORIGINS: 'https://admin.example.test',
      API_CORS_ORIGINS: ' , ',
    });
    expect(blank.API_CORS_ORIGINS).toEqual([]);
    expect(corsOriginsFrom(blank)).toEqual(['https://admin.example.test']);
  });

  it('uses API_CORS_ORIGINS for CORS without widening AUTH_TRUSTED_ORIGINS', () => {
    const cfg = readConfig({
      ...valid,
      AUTH_TRUSTED_ORIGINS: 'https://admin.example.test, https://pos.example.test',
      API_CORS_ORIGINS: 'https://pos.example.test, capacitor://localhost',
    });
    expect(cfg.AUTH_TRUSTED_ORIGINS).toEqual([
      'https://admin.example.test',
      'https://pos.example.test',
    ]);
    expect(corsOriginsFrom(cfg)).toEqual(['https://pos.example.test', 'capacitor://localhost']);
  });

  it('refuses RATING_PAGE_ORIGIN when matched by API_CORS_ORIGINS without echoing it', () => {
    const attempt = () =>
      readConfig({
        ...valid,
        RATING_PAGE_ORIGIN: 'https://rating.example.test',
        API_CORS_ORIGINS: 'https://admin.example.test, https://*.example.test',
      });
    expect(attempt).toThrow(/RATING_PAGE_ORIGIN/);
    expect(attempt).not.toThrow('https://rating.example.test');
  });
});

describe('RATING_PAGE_ORIGIN vs COOKIE_DOMAIN (#856)', () => {
  it.each([
    'https://rating.pospay.systems',
    'https://pospay.systems',
    'https://RATING.POSPAY.SYSTEMS:8443',
  ])(
    'refuses %s under COOKIE_DOMAIN=.pospay.systems without echoing raw values',
    (ratingOrigin) => {
      const attempt = () =>
        readConfig({
          ...valid,
          COOKIE_DOMAIN: '.pospay.systems',
          RATING_PAGE_ORIGIN: ratingOrigin,
        });
      expect(attempt).toThrow(/RATING_PAGE_ORIGIN/);
      expect(attempt).not.toThrow('pospay.systems');
    },
  );

  it.each(['https://pospay.menu', 'https://notpospay.systems'])(
    'allows %s outside COOKIE_DOMAIN=.pospay.systems',
    (ratingOrigin) => {
      expect(
        readConfig({
          ...valid,
          COOKIE_DOMAIN: '.pospay.systems',
          RATING_PAGE_ORIGIN: ratingOrigin,
        }).RATING_PAGE_ORIGIN,
      ).toBe(ratingOrigin);
    },
  );
});
