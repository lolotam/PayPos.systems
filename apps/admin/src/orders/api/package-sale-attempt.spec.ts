import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PACKAGE_SALE_CLOCK_SKEW_MS,
  PACKAGE_SALE_REPLAY_WINDOW_MS,
  inspectSaleAttempt,
  reconcileSaleAttempt,
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

describe('reconcileSaleAttempt', () => {
  const saleId = '01920000-0000-7000-8000-0000000000b2';

  it('returns the held attempt, or null, when nothing is stored', () => {
    const held = attempt({ seenAt: minute });
    expect(reconcileSaleAttempt(held, null)).toBe(held);
    expect(reconcileSaleAttempt(undefined, null)).toBeNull();
  });

  it('lets the stored record win when nothing is held or the keys differ', () => {
    const stored = attempt({ key: 'stored-key' });
    expect(reconcileSaleAttempt(undefined, stored)).toBe(stored);
    expect(reconcileSaleAttempt(attempt({ saleId }), stored)).toBe(stored);
  });

  it('keeps the held sale id when storage is behind for the same key', () => {
    const held = attempt({ saleId });
    expect(reconcileSaleAttempt(held, attempt({ seenAt: minute }))).toBe(held);
  });

  it('lets a stored sale id win for the same key', () => {
    const stored = attempt({ saleId });
    expect(reconcileSaleAttempt(attempt({ seenAt: minute }), stored)).toBe(stored);
    expect(reconcileSaleAttempt(attempt({ saleId: 'older-sale' }), stored)).toBe(stored);
  });

  it('returns the stored record when its observation is at or after the held one', () => {
    const stored = attempt({ seenAt: 2 * minute });
    expect(reconcileSaleAttempt(attempt({ seenAt: minute }), stored)).toBe(stored);
    expect(reconcileSaleAttempt(attempt({ seenAt: 2 * minute }), stored)).toBe(stored);
    expect(reconcileSaleAttempt(attempt(), attempt())).toEqual(attempt());
  });

  it('carries the later held observation onto a copy of the stored record', () => {
    const held = attempt({ seenAt: replayWindow });
    const stored = attempt({ seenAt: 30 * minute });
    const reconciled = reconcileSaleAttempt(held, stored);
    expect(reconciled).toEqual(attempt({ seenAt: replayWindow }));
    expect(reconciled).not.toBe(stored);
    expect(stored.seenAt).toBe(30 * minute);
    expect(held.seenAt).toBe(replayWindow);
  });
});

describe('inspectSaleAttempt', () => {
  const scope = attempt().scope;
  const storageKey = `pospay:package-sale:${scope}`;

  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('reports an unreadable device when reading storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('private');
    });
    expect(inspectSaleAttempt(scope)).toEqual({ readable: false, attempt: null });
  });

  it('reports a readable device holding nothing valid for garbage and absent records', () => {
    expect(inspectSaleAttempt(scope)).toEqual({ readable: true, attempt: null });
    localStorage.setItem(storageKey, '{not json');
    expect(inspectSaleAttempt(scope)).toEqual({ readable: true, attempt: null });
  });

  it('returns a stored status-only record', () => {
    const settled = attempt({ saleId: '01920000-0000-7000-8000-0000000000b2' });
    localStorage.setItem(storageKey, JSON.stringify(settled));
    expect(inspectSaleAttempt(scope)).toEqual({ readable: true, attempt: settled });
  });
});
