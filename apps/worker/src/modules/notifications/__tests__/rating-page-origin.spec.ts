import { describe, expect, it } from 'vitest';

import { FAKE_RATING_PAGE_ORIGIN, resolveRatingPageOrigin } from '../domain/rating-page-origin.ts';

describe('resolveRatingPageOrigin', () => {
  it.each([undefined, ''])('falls back to the fake origin outside production when %j', (raw) => {
    expect(resolveRatingPageOrigin(raw, false)).toBe(FAKE_RATING_PAGE_ORIGIN);
  });

  it.each([undefined, ''])('has no fallback in production or live mode when %j', (raw) => {
    expect(resolveRatingPageOrigin(raw, true)).toBeNull();
  });

  it('accepts an exact https origin everywhere and http only outside production', () => {
    expect(resolveRatingPageOrigin('https://rating.pospay.test', true)).toBe(
      'https://rating.pospay.test',
    );
    expect(resolveRatingPageOrigin('http://localhost:3000', false)).toBe('http://localhost:3000');
    expect(resolveRatingPageOrigin('http://localhost:3000', true)).toBeNull();
  });

  it.each([
    'https://rating.pospay.test/',
    'https://rating.pospay.test/path',
    'https://rating.pospay.test?x=1',
    'https://rating.pospay.test#frag',
    'https://user:pass@rating.pospay.test',
    'ftp://rating.pospay.test',
    'rating.pospay.test',
    'not a url',
  ])('fails closed on %s', (raw) => {
    expect(resolveRatingPageOrigin(raw, false)).toBeNull();
    expect(resolveRatingPageOrigin(raw, true)).toBeNull();
  });
});
