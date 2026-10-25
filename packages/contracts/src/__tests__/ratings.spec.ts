import { describe, expect, it } from 'vitest';

import {
  ratingCancelReason,
  ratingComment,
  ratingRequestStatus,
  ratingStars,
  ratingView,
  submitRatingInput,
} from '../customers/ratings.js';

describe('rating request contracts', () => {
  it.each(['SCHEDULED', 'SENDING', 'SENT', 'CANCELLED'])('accepts status %s', (status) => {
    expect(ratingRequestStatus.parse(status)).toBe(status);
  });

  it.each(['NO_ACTIVE_LINE', 'PAST_DEADLINE', 'OPTED_OUT'])('accepts reason %s', (reason) => {
    expect(ratingCancelReason.parse(reason)).toBe(reason);
  });

  it.each(['REQUESTS_OFF', 'scheduled', 'SENT ', 'UNKNOWN'])(
    'refuses foreign status %s',
    (value) => {
      expect(ratingRequestStatus.safeParse(value).success).toBe(false);
    },
  );

  it.each(['REQUESTS_OFF', 'opted_out', 'NO_LINE'])('refuses foreign reason %s', (value) => {
    expect(ratingCancelReason.safeParse(value).success).toBe(false);
  });
});

describe('rating submission contract', () => {
  it.each([0, 6, 2.5, '3'])('refuses stars %s', (stars) => {
    expect(ratingStars.safeParse(stars).success).toBe(false);
  });

  it.each([1, 5])('accepts boundary stars %s', (stars) => {
    expect(ratingStars.parse(stars)).toBe(stars);
  });

  it.each([
    ['ASCII', 'a'],
    ['Arabic', 'ت'],
    ['astral', '😀'],
  ])('accepts 1000 and refuses 1001 %s code points', (_label, character) => {
    expect(ratingComment.safeParse(character.repeat(1000)).success).toBe(true);
    expect(ratingComment.safeParse(character.repeat(1001)).success).toBe(false);
  });

  it.each([
    ['U+0000', String.fromCharCode(0)],
    ['U+0001', String.fromCharCode(1)],
    ['U+0008', String.fromCharCode(8)],
    ['U+000B', String.fromCharCode(11)],
    ['U+000C', String.fromCharCode(12)],
    ['U+007F', String.fromCharCode(127)],
    ['U+0085', String.fromCharCode(133)],
  ])('refuses a comment carrying %s', (_label, character) => {
    expect(ratingComment.safeParse(`comment${character}`).success).toBe(false);
  });

  it('accepts a multi-line comment, a CRLF and a tab', () => {
    const lineFeed = String.fromCharCode(10);
    const carriageReturn = String.fromCharCode(13);
    const tab = String.fromCharCode(9);
    expect(ratingComment.safeParse(`first line${lineFeed}second line`).success).toBe(true);
    expect(
      ratingComment.safeParse(`first line${carriageReturn}${lineFeed}second line`).success,
    ).toBe(true);
    expect(ratingComment.safeParse(`first line${tab}second line`).success).toBe(true);
  });

  it('accepts a 1000-code-point comment of newlines and refuses 1001', () => {
    const newline = String.fromCharCode(10);
    expect(ratingComment.safeParse(newline.repeat(1000)).success).toBe(true);
    expect(ratingComment.safeParse(newline.repeat(1001)).success).toBe(false);
  });
});

describe('rating comment links and markup', () => {
  it.each([
    ['a URL with a scheme', 'see https://example.com'],
    ['an upper-case URL', 'HTTP://EXAMPLE.COM'],
    ['a bare www host', 'visit www.example.com'],
    ['a www host in brackets', 'Check (www.example.com)'],
    ['a Markdown link', '[click](x)'],
    ['a Markdown image', '![pic](x)'],
    ['an HTML tag with attributes', '<img src=x onerror=alert(1)>'],
    ['an HTML tag', '<b>bold</b>'],
    ['a self-closing HTML tag', 'line<br/>break'],
  ])('refuses a comment with %s', (_label, comment) => {
    expect(ratingComment.safeParse(comment).success).toBe(false);
  });

  it.each([
    ['a fraction', '5/5'],
    ['a comparison', 'a<b'],
    ['a spaced angle bracket', 'x < y'],
    ['Arabic with a line break', `ممتاز جداً${String.fromCharCode(10)}شكراً لكم`],
    ['a bare domain', 'wow.example'],
    ['plain words', 'write a review: 5 stars'],
  ])('accepts a comment with %s', (_label, comment) => {
    expect(ratingComment.safeParse(comment).success).toBe(true);
  });

  it('accepts an empty comment', () => {
    expect(ratingComment.parse('')).toBe('');
  });
});

describe('rating submission body', () => {
  it('accepts stars alone and an optional comment', () => {
    expect(submitRatingInput.parse({ stars: 5 })).toEqual({ stars: 5 });
    expect(submitRatingInput.parse({ stars: 2, comment: '' })).toEqual({ stars: 2, comment: '' });
  });

  // الأسماء دي مفاتيح بيختارها العميل، والقيمة 1 fixture للاختبار ومش بيانات اعتماد.
  it.each(['token', 'company_id', 'performer_ids'])('refuses the client-selected key %s', (key) => {
    expect(submitRatingInput.safeParse({ stars: 5, [key]: 1 }).success).toBe(false);
  });
});

describe('public rating view allowlist', () => {
  it('contains exactly business_name and state', () => {
    expect(Object.keys(ratingView.shape).sort()).toEqual(['business_name', 'state']);
    expect(ratingView.parse({ business_name: 'Synthetic salon', state: 'open' })).toEqual({
      business_name: 'Synthetic salon',
      state: 'open',
    });
  });

  it('accepts the longest persisted business name and refuses one character more', () => {
    expect(ratingView.safeParse({ business_name: 'a'.repeat(255), state: 'open' }).success).toBe(
      true,
    );
    expect(ratingView.safeParse({ business_name: 'a'.repeat(256), state: 'open' }).success).toBe(
      false,
    );
  });

  it('counts the business name in code points, not UTF-16 units', () => {
    expect(ratingView.safeParse({ business_name: '😀'.repeat(255), state: 'open' }).success).toBe(
      true,
    );
    expect(ratingView.safeParse({ business_name: '😀'.repeat(256), state: 'open' }).success).toBe(
      false,
    );
  });
});
