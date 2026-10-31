import { describe, expect, it } from 'vitest';

import {
  ratingCancelReason,
  ratingRequestStatus,
  ratingStars,
  ratingView,
  submitRatingInput,
} from '../customers/ratings.js';
import { RATING_REQUESTS_DEFAULT_ENABLED, ratingSettings } from '../customers/rating-settings.js';

describe('rating request contracts', () => {
  it.each(['SCHEDULED', 'SENDING', 'SENT', 'CANCELLED'])('accepts status %s', (status) => {
    expect(ratingRequestStatus.parse(status)).toBe(status);
  });

  it.each(['NO_ACTIVE_LINE', 'PAST_DEADLINE', 'OPTED_OUT', 'REQUESTS_OFF'])(
    'accepts reason %s',
    (reason) => {
      expect(ratingCancelReason.parse(reason)).toBe(reason);
    },
  );

  it.each(['REQUESTS_OFF', 'scheduled', 'SENT ', 'UNKNOWN'])(
    'refuses foreign status %s',
    (value) => {
      expect(ratingRequestStatus.safeParse(value).success).toBe(false);
    },
  );

  it.each(['opted_out', 'NO_LINE', 'REQUESTS_OFF '])('refuses foreign reason %s', (value) => {
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

describe('rating requests switch', () => {
  it('carries the switch value and nothing else', () => {
    expect(ratingSettings.parse({ requests_enabled: true })).toEqual({ requests_enabled: true });
    expect(ratingSettings.parse({ requests_enabled: false })).toEqual({ requests_enabled: false });
    expect(Object.keys(ratingSettings.shape)).toEqual(['requests_enabled']);
  });

  it('refuses a missing value, a string and a foreign key', () => {
    expect(ratingSettings.safeParse({}).success).toBe(false);
    expect(ratingSettings.safeParse({ requests_enabled: 'true' }).success).toBe(false);
    expect(ratingSettings.safeParse({ requests_enabled: true, alerts_enabled: true }).success).toBe(
      false,
    );
  });

  it('is off by default, the same constant the worker reads', () => {
    expect(RATING_REQUESTS_DEFAULT_ENABLED).toBe(false);
  });
});
