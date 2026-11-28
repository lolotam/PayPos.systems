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
});

describe('API_CORS_ORIGINS validation (#669)', () => {
  it.each([
    '*',
    'https://*.example.test',
    'https://rat?ng.example.test',
    'capacitor://other',
    'https://pos.example.test/path',
  ])('rejects wildcard or non-exact API_CORS_ORIGINS entry %s without echoing it', (bad) => {
    const attempt = () => readConfig({ ...valid, API_CORS_ORIGINS: bad });
    expect(attempt).toThrow(/API_CORS_ORIGINS/);
    expect(attempt).not.toThrow(bad);
  });

  it('reports API_CORS_ORIGINS without throwing TypeError when a non-string value is passed alongside RATING_PAGE_ORIGIN', () => {
    expect(() =>
      readConfig({
        ...valid,
        RATING_PAGE_ORIGIN: 'https://rating.example.test',
        API_CORS_ORIGINS: 123 as unknown as string,
      }),
    ).toThrow(/Invalid API configuration:.*API_CORS_ORIGINS/);
  });

  it('refuses RATING_PAGE_ORIGIN matching an exact API_CORS_ORIGINS entry without echoing it', () => {
    const attempt = () =>
      readConfig({
        ...valid,
        RATING_PAGE_ORIGIN: 'https://rating.example.test',
        API_CORS_ORIGINS: 'https://admin.example.test, https://rating.example.test',
      });
    expect(attempt).toThrow(/RATING_PAGE_ORIGIN/);
    expect(attempt).not.toThrow('https://rating.example.test');
  });
});

describe('RATING_PAGE_ORIGIN vs COOKIE_DOMAIN (#856)', () => {
  it.each([
    ['.pospay.systems', 'https://rating.pospay.systems'],
    ['.pospay.systems', 'https://pospay.systems'],
    ['.pospay.systems', 'https://rating.pospay.systems:8443'],
    ['.pospay.systems', 'https://rating.pospay.systems.'],
    ['.pospay.systems', 'https://pospay.systems.'],
    ['.staging.pospay.systems', 'https://rating.pospay.systems'],
  ])(
    'refuses COOKIE_DOMAIN=%s with %s without echoing raw values',
    (cookieDomain, ratingOrigin) => {
      const attempt = () =>
        readConfig({
          ...valid,
          COOKIE_DOMAIN: cookieDomain,
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

  it.each([
    'https://api.example.test:8443',
    'https://api.example.test.',
    'http://api.example.test',
  ])(
    'refuses RATING_PAGE_ORIGIN=%s sharing BETTER_AUTH_URL hostname even when COOKIE_DOMAIN is unset',
    (ratingOrigin) => {
      const attempt = () =>
        readConfig({
          ...valid,
          NODE_ENV: 'test',
          BETTER_AUTH_URL: 'https://api.example.test',
          RATING_PAGE_ORIGIN: ratingOrigin,
        });
      expect(attempt).toThrow(/RATING_PAGE_ORIGIN/);
      expect(attempt).not.toThrow('api.example.test');
    },
  );
});
