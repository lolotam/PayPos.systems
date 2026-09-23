import { describe, expect, it } from 'vitest';

import {
  isLockingFailure,
  isPinAttemptLocked,
  isWellFormedCashierPin,
  PIN_LOCK_SECONDS,
} from '../cashier-pin.ts';

describe('cashier PIN (PRD D-08)', () => {
  it('is exactly four digits', () => {
    for (const pin of ['0000', '4821', '9999']) expect(isWellFormedCashierPin(pin)).toBe(true);
    for (const pin of ['', '482', '48210', '48a1', ' 4821', '4821\n', '٤٨٢١']) {
      expect(isWellFormedCashierPin(pin)).toBe(false);
    }
  });

  it('five attempts are compared; the sixth and later are refused unseen', () => {
    for (const attempt of [1, 2, 3, 4, 5]) expect(isPinAttemptLocked(attempt)).toBe(false);
    for (const attempt of [6, 7, 100]) expect(isPinAttemptLocked(attempt)).toBe(true);
  });

  it('the fifth failure — and only it — starts the lock, for 15 minutes', () => {
    expect([1, 2, 3, 4, 5, 6].map(isLockingFailure)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
    ]);
    expect(PIN_LOCK_SECONDS).toBe(900);
  });
});
