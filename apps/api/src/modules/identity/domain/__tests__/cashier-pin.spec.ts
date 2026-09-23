import { describe, expect, it } from 'vitest';

import { isWellFormedCashierPin, PIN_LOCK_SECONDS, PIN_MAX_FAILURES } from '../cashier-pin.ts';

describe('cashier PIN (PRD D-08)', () => {
  it('is exactly four digits', () => {
    for (const pin of ['0000', '4821', '9999']) expect(isWellFormedCashierPin(pin)).toBe(true);
    for (const pin of ['', '482', '48210', '48a1', ' 4821', '4821\n', '٤٨٢١']) {
      expect(isWellFormedCashierPin(pin)).toBe(false);
    }
  });

  it('locks after five failures, for 15 minutes', () => {
    expect([PIN_MAX_FAILURES, PIN_LOCK_SECONDS]).toEqual([5, 900]);
  });
});
