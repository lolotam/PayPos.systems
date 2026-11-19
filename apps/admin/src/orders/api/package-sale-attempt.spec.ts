import { describe, expect, it } from 'vitest';
import {
  PACKAGE_SALE_CLOCK_SKEW_MS,
  PACKAGE_SALE_REPLAY_WINDOW_MS,
  saleAttemptExpired,
  saleAttemptExpiresIn,
  touchSaleAttempt,
  type HeldAttempt,
} from './package-sale-attempt';

const replayWindow = PACKAGE_SALE_REPLAY_WINDOW_MS;
const minute = 60_000;
const tolerance = PACKAGE_SALE_CLOCK_SKEW_MS;

const attempt = (overrides: Partial<HeldAttempt> = {}): HeldAttempt => ({
  key: '01920000-0000-7000-8000-0000000000a1',
  scope: '["company","business","branch","user"]',
  createdAt: 0,
  ...overrides,
});

describe('touchSaleAttempt', () => {
  it('returns the same object for a fresh attempt observed within one minute', () => {
    const fresh = attempt({ createdAt: 1_000 });
    expect(touchSaleAttempt(fresh, 1_000 + minute - 1)).toBe(fresh);
  });

  it('records the observation time once more than a minute has passed', () => {
    expect(touchSaleAttempt(attempt({ createdAt: 0 }), minute)).toEqual(
      attempt({ createdAt: 0, seenAt: minute }),
    );
  });

  it('latches an age-expired attempt to exactly the window end', () => {
    const latched = touchSaleAttempt(attempt({ createdAt: 0 }), replayWindow + 1);
    expect(latched).toEqual(attempt({ createdAt: 0, seenAt: replayWindow }));
  });

  it('returns the same latched record whatever the clock reads afterwards', () => {
    const latched = touchSaleAttempt(attempt({ createdAt: 0 }), replayWindow + 1);
    expect(touchSaleAttempt(latched, Number.MAX_SAFE_INTEGER)).toBe(latched);
    expect(touchSaleAttempt(latched, 0)).toBe(latched);
  });

  it('latches when the clock falls six minutes behind the last observation', () => {
    const observed = attempt({ createdAt: 0, seenAt: 30 * minute });
    const latched = touchSaleAttempt(observed, 24 * minute);
    expect(latched).toEqual(attempt({ createdAt: 0, seenAt: replayWindow }));
  });

  it('keeps a four-minute backward correction unexpired and untouched', () => {
    const observed = attempt({ createdAt: 0, seenAt: 30 * minute });
    expect(saleAttemptExpired(observed, 26 * minute)).toBe(false);
    expect(touchSaleAttempt(observed, 26 * minute)).toBe(observed);
  });

  it('never touches a status-only record', () => {
    const settled = attempt({ createdAt: 0, saleId: '01920000-0000-7000-8000-0000000000b2' });
    expect(touchSaleAttempt(settled, 10 * replayWindow)).toBe(settled);
    expect(touchSaleAttempt(settled, -minute)).toBe(settled);
  });
});

describe('saleAttemptExpired', () => {
  it('is true once the age reaches the window and false one minute before', () => {
    expect(saleAttemptExpired(attempt({ createdAt: 0 }), replayWindow)).toBe(true);
    expect(saleAttemptExpired(attempt({ createdAt: 0 }), replayWindow - 1)).toBe(false);
  });

  it('is true only when the clock falls more than the tolerance behind the last observation', () => {
    const observed = attempt({ createdAt: 0, seenAt: 30 * minute });
    expect(saleAttemptExpired(observed, 30 * minute - tolerance - 1)).toBe(true);
    expect(saleAttemptExpired(observed, 30 * minute - tolerance)).toBe(false);
  });

  it('measures the age against the later of the clock and the last observation', () => {
    const observed = attempt({ createdAt: 0, seenAt: replayWindow - minute });
    expect(saleAttemptExpired(observed, 0)).toBe(true);
  });
});

describe('saleAttemptExpiresIn', () => {
  it('is zero when the attempt is already expired', () => {
    expect(saleAttemptExpiresIn(attempt({ createdAt: 0, seenAt: replayWindow }), 0)).toBe(0);
    expect(saleAttemptExpiresIn(attempt({ createdAt: 0 }), 2 * replayWindow)).toBe(0);
  });

  it('counts from the later of the clock and the last observation', () => {
    expect(saleAttemptExpiresIn(attempt({ createdAt: 0 }), minute)).toBe(replayWindow - minute);
    expect(saleAttemptExpiresIn(attempt({ createdAt: 0, seenAt: 30 * minute }), 28 * minute)).toBe(
      replayWindow - 30 * minute,
    );
  });
});
