import { describe, expect, it } from 'vitest';

import {
  RATING_TOKEN_LIFETIME_HOURS,
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

  it('uses the seven-day token lifetime', () => {
    expect(RATING_TOKEN_LIFETIME_HOURS).toBe(168);
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

  it('accepts stars alone and an optional comment', () => {
    expect(submitRatingInput.parse({ stars: 5 })).toEqual({ stars: 5 });
    expect(submitRatingInput.parse({ stars: 2, comment: '' })).toEqual({ stars: 2, comment: '' });
  });

  it.each([
    { stars: 5, token: 'synthetic' },
    { stars: 5, company_id: '01920000-0000-7000-8000-0000000000a0' },
    { stars: 5, performer_ids: ['01920000-0000-7000-8000-0000000000a3'] },
  ])('refuses a client-selected capability key: %j', (body) => {
    expect(submitRatingInput.safeParse(body).success).toBe(false);
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
});
