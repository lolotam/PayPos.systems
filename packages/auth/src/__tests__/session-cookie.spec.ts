import { describe, expect, it } from 'vitest';

import { sessionCookieNames } from '../session-cookie.ts';

describe('the session cookie names', () => {
  it('keeps the exact name production uses today when no prefix is configured', () => {
    expect(sessionCookieNames({ secureCookies: false })).toEqual({
      prefix: 'pospay',
      normal: 'pospay.session_token',
    });
    expect(sessionCookieNames({ secureCookies: true }).normal).toBe(
      '__Secure-pospay.session_token',
    );
  });

  it('carries the configured prefix', () => {
    expect(sessionCookieNames({ cookiePrefix: 'pospay-stg', secureCookies: false })).toEqual({
      prefix: 'pospay-stg',
      normal: 'pospay-stg.session_token',
    });
    expect(sessionCookieNames({ cookiePrefix: 'pospay-stg', secureCookies: true }).normal).toBe(
      '__Secure-pospay-stg.session_token',
    );
  });

  it.each(['PosPay', 'pospay_stg', 'pospay.stg', '1pospay', 'p', 'a'.repeat(32)])(
    'refuses a prefix that is not a cookie-name prefix: %s',
    (cookiePrefix) => {
      expect(() => sessionCookieNames({ cookiePrefix, secureCookies: false })).toThrow(
        /AUTH_COOKIE_PREFIX/,
      );
    },
  );
});
