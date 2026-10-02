import { MONEY_MAX, sumMoney } from '@pospay/domain';
import { describe, expect, it } from 'vitest';

import { PackageRuleError } from '../errors.js';
import {
  canReversePackageRedemption,
  createPackageSlots,
  selectPackageRedemptionSlot,
  selectPackageRefundSlots,
  type PackageSlot,
  type PackageSlotState,
} from '../package-slots.js';

const mixedSlots: readonly PackageSlot[] = [
  { ordinal: 5, unitValue: 4n, state: 'FREE' },
  { ordinal: 2, unitValue: 3n, state: 'USED', redemptionId: 'redemption-2' },
  { ordinal: 4, unitValue: 3n, state: 'REFUNDED' },
  { ordinal: 1, unitValue: 3n, state: 'IMPORTED_USED' },
  { ordinal: 3, unitValue: 3n, state: 'FREE' },
];

describe('original and imported slot valuations (PKG-04…06)', () => {
  it.each([
    [10n, 3, [3n, 3n, 4n]],
    [2n, 4, [0n, 0n, 0n, 2n]],
    [12n, 3, [4n, 4n, 4n]],
    [MONEY_MAX, 1, [MONEY_MAX]],
    [0n, 3, [0n, 0n, 0n]],
  ] as const)('component %s across %s sessions', (value, sessions, expected) => {
    const slots = createPackageSlots(value, sessions);
    expect(slots.map((slot) => slot.unitValue)).toEqual(expected);
    expect(slots.map((slot) => slot.ordinal)).toEqual(
      Array.from({ length: sessions }, (_, i) => i + 1),
    );
    expect(slots.every((slot) => slot.state === 'FREE')).toBe(true);
  });

  it.each([
    [0, ['IMPORTED_USED', 'IMPORTED_USED', 'IMPORTED_USED']],
    [1, ['IMPORTED_USED', 'IMPORTED_USED', 'FREE']],
    [2, ['IMPORTED_USED', 'FREE', 'FREE']],
    [3, ['FREE', 'FREE', 'FREE']],
  ] as const)('remaining %s preserves original ordinal values', (remaining, states) => {
    const slots = createPackageSlots(10n, 3, remaining);
    expect(slots.map((slot) => slot.state)).toEqual(states);
    expect(slots.map((slot) => slot.unitValue)).toEqual([3n, 3n, 4n]);
  });

  it('conserves all tiny component values across every valid imported usage count', () => {
    for (let value = 0n; value <= 20n; value++) {
      for (let sessions = 1; sessions <= 6; sessions++) {
        for (let remaining = 0; remaining <= sessions; remaining++) {
          const slots = createPackageSlots(value, sessions, remaining);
          expect(sumMoney(slots.map((slot) => slot.unitValue))).toBe(value);
          expect(slots.filter((slot) => slot.state === 'FREE')).toHaveLength(remaining);
          expect(
            slots.slice(0, sessions - remaining).every((slot) => slot.state === 'IMPORTED_USED'),
          ).toBe(true);
        }
      }
    }
  });
});

describe('pure redemption and refund selections (PKG-07/08)', () => {
  it('selects the lowest FREE ordinal regardless of input order and gaps', () => {
    expect(selectPackageRedemptionSlot(mixedSlots)).toEqual(mixedSlots[4]);
    expect(selectPackageRedemptionSlot([...mixedSlots].reverse())).toEqual(mixedSlots[4]);
  });

  it('refunds highest FREE ordinals and their stored amount exactly', () => {
    expect(selectPackageRefundSlots(mixedSlots, 1)).toEqual({ ordinals: [5], amount: 4n });
    expect(selectPackageRefundSlots(mixedSlots, 2)).toEqual({ ordinals: [5, 3], amount: 7n });
    expect(selectPackageRefundSlots([...mixedSlots].reverse(), 2)).toEqual({
      ordinals: [5, 3],
      amount: 7n,
    });
  });

  it('cannot redeem or refund any USED, REFUNDED or IMPORTED_USED slot', () => {
    const unavailable = mixedSlots.filter((slot) => slot.state !== 'FREE');
    for (const slots of [[], unavailable]) {
      expect(() => selectPackageRedemptionSlot(slots)).toThrow(
        new PackageRuleError('INSUFFICIENT_SLOTS'),
      );
      expect(() => selectPackageRefundSlots(slots, 1)).toThrow(
        new PackageRuleError('INSUFFICIENT_SLOTS'),
      );
    }
  });

  it('rejects an oversized refund without changing any state (M14)', () => {
    const before = structuredClone(mixedSlots);
    expect(() => selectPackageRefundSlots(mixedSlots, 3)).toThrow(
      new PackageRuleError('INSUFFICIENT_SLOTS'),
    );
    expect(mixedSlots).toEqual(before);
  });

  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'refund count %s must be a positive safe integer',
    (sessions) => {
      expect(() => selectPackageRefundSlots(mixedSlots, sessions)).toThrow(
        new PackageRuleError('INVALID_SESSIONS'),
      );
    },
  );

  it('allows a zero-money refund when the chosen free slots have zero value', () => {
    expect(selectPackageRefundSlots(createPackageSlots(0n, 2), 2)).toEqual({
      ordinals: [2, 1],
      amount: 0n,
    });
  });
});

describe('selection snapshots and validation', () => {
  it('does not mutate frozen snapshots or expose the selected object', () => {
    const slots = Object.freeze(mixedSlots.map((slot) => Object.freeze({ ...slot })));
    expect(selectPackageRedemptionSlot(slots)).not.toBe(slots[4]);
    expect(selectPackageRefundSlots(slots, 2)).toEqual({ ordinals: [5, 3], amount: 7n });
    expect(slots).toEqual(mixedSlots);
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects ordinal %s',
    (ordinal) => {
      const slots = [{ ordinal, state: 'FREE' as const, unitValue: 0n }];
      expect(() => selectPackageRedemptionSlot(slots)).toThrow(
        new PackageRuleError('INVALID_SLOTS'),
      );
      expect(() => selectPackageRefundSlots(slots, 1)).toThrow(
        new PackageRuleError('INVALID_SLOTS'),
      );
    },
  );

  it('rejects duplicate ordinals rather than selecting the same slot twice', () => {
    const slots = [{ ordinal: 1, state: 'FREE' as const, unitValue: 1n }];
    expect(() => selectPackageRefundSlots([...slots, ...slots], 2)).toThrow(
      new PackageRuleError('INVALID_SLOTS'),
    );
  });

  it('rejects invalid stored values even on unavailable slots', () => {
    const slots: PackageSlot[] = [{ ordinal: 1, state: 'USED', unitValue: -1n }];
    expect(() => selectPackageRedemptionSlot(slots)).toThrow(new PackageRuleError('INVALID_PRICE'));
    expect(() => selectPackageRefundSlots(slots, 1)).toThrow(new PackageRuleError('INVALID_PRICE'));
  });

  it('accepts the maximum stored money value in a one-slot refund', () => {
    expect(selectPackageRefundSlots(createPackageSlots(MONEY_MAX, 1), 1)).toEqual({
      ordinals: [1],
      amount: MONEY_MAX,
    });
  });
});

describe('redemption cancellation ownership and stale retry (PKG-10)', () => {
  it.each(['FREE', 'USED', 'REFUNDED', 'IMPORTED_USED'] as const)(
    'checks every state %s, reversal flag and matching/current owner',
    (state: PackageSlotState) => {
      for (const alreadyReversed of [false, true]) {
        for (const redemptionId of ['current', 'stale']) {
          const slot: PackageSlot = { ordinal: 1, unitValue: 3n, state, redemptionId: 'current' };
          expect(canReversePackageRedemption(slot, redemptionId, alreadyReversed)).toBe(
            state === 'USED' && !alreadyReversed && redemptionId === 'current',
          );
        }
      }
    },
  );

  it('does not reverse USED without a current redemption identity', () => {
    expect(
      canReversePackageRedemption({ ordinal: 1, unitValue: 3n, state: 'USED' }, 'current', false),
    ).toBe(false);
  });

  it('a freed ordinal becomes the next redemption and an old retry cannot free its new owner (M8)', () => {
    const current: PackageSlot = { ordinal: 1, unitValue: 3n, state: 'USED', redemptionId: 'old' };
    expect(canReversePackageRedemption(current, 'old', false)).toBe(true);
    const freed: PackageSlot = { ordinal: 1, unitValue: current.unitValue, state: 'FREE' };
    expect(
      selectPackageRedemptionSlot([{ ordinal: 5, unitValue: 4n, state: 'FREE' }, freed]),
    ).toEqual(freed);
    expect(
      canReversePackageRedemption({ ...freed, state: 'USED', redemptionId: 'new' }, 'old', false),
    ).toBe(false);
    expect(canReversePackageRedemption(current, 'old', true)).toBe(false);
  });
});
