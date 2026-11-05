import { expect, it } from 'vitest';
import { securityHeaders } from './security-headers';

it('prevents public rating caching, referrers, indexing and embedding', () => {
  const headers = Object.fromEntries(securityHeaders.map(({ key, value }) => [key, value]));
  expect(headers).toMatchObject({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
  });
});
