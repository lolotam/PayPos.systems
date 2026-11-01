import { describe, expect, it } from 'vitest';

import { displaySafeFirstWord } from '../display-name.ts';
import { expiresAt, RATING_LINK_LIFETIME_MS } from '../rating-link-expiry.ts';

describe('display safe first word', () => {
  it.each([
    { title: 'keeps the first word of an arabic name', value: 'أحمد علي', expected: 'أحمد' },
    { title: 'keeps a single english name', value: 'Ahmed', expected: 'Ahmed' },
    { title: 'trims the name before cutting it', value: '  أحمد  علي ', expected: 'أحمد' },
    { title: 'keeps a year inside a name', value: 'أحمد 1990', expected: 'أحمد' },
    { title: 'refuses an empty name', value: '   ', expected: null },
    { title: 'refuses a missing name', value: null, expected: null },
    { title: 'refuses a bare code', value: '12345678', expected: null },
    { title: 'refuses a phone number', value: '+96550000000', expected: null },
    { title: 'refuses a spaced phone number', value: '965 5000 0000', expected: null },
    { title: 'refuses a link', value: 'example.com', expected: null },
    { title: 'refuses a scheme link', value: 'https://example.com', expected: null },
    { title: 'refuses a secret word', value: 'token', expected: null },
  ])('$title', ({ value, expected }) => {
    expect(displaySafeFirstWord(value)).toBe(expected);
  });
});

describe('rating link expiry', () => {
  it('ends seven days after the claim', () => {
    expect(expiresAt(new Date('2026-10-31T10:00:00.000Z')).toISOString()).toBe(
      '2026-11-07T10:00:00.000Z',
    );
  });

  it('uses the same seven days the database constraint writes', () => {
    expect(RATING_LINK_LIFETIME_MS).toBe(168 * 60 * 60 * 1000);
  });
});
