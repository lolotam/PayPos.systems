import { MONEY_MAX } from '@pospay/domain';
import { describe, expect, it } from 'vitest';

import { PackageRuleError } from '../errors.js';
import { planPackageRefund, type PackageRefundFacts } from '../package-refund-plan.js';
import { createPackageSlots, type PackageSlot } from '../package-slots.js';

const slots: readonly PackageSlot[] = [
  { ordinal: 3, unitValue: 3n, state: 'FREE' },
  { ordinal: 5, unitValue: 4n, state: 'FREE' },
  { ordinal: 2, unitValue: 90n, state: 'USED', redemptionId: 'current' },
  { ordinal: 4, unitValue: 80n, state: 'REFUNDED' },
  { ordinal: 1, unitValue: 70n, state: 'IMPORTED_USED' },
];

const facts: PackageRefundFacts = {
  provenance: 'SOLD',
  importedRefundsEnabled: false,
  today: '2026-10-02',
  expiresOn: '2026-10-02',
  slots,
  requestedSessions: 2,
  refundedAmount: 11n,
  revision: 4,
};

describe('planPackageRefund: stored monetary and state plan', () => {
  it('selects highest FREE ordinals from unsorted facts and excludes every unavailable state', () => {
    expect(planPackageRefund(facts)).toEqual({
      accepted: true,
      selectedSlots: [
        { ordinal: 5, unitValue: 4n },
        { ordinal: 3, unitValue: 3n },
      ],
      amount: 7n,
      newRefundedAmount: 18n,
      newRevision: 5,
      publicationRequired: true,
    });
    expect(planPackageRefund({ ...facts, slots: [...slots].reverse() })).toEqual(
      planPackageRefund(facts),
    );
  });

  it('takes only the requested count and sums stored values without catalog repricing', () => {
    const result = planPackageRefund({ ...facts, requestedSessions: 1 });
    expect(result).toEqual({
      accepted: true,
      selectedSlots: [{ ordinal: 5, unitValue: 4n }],
      amount: 4n,
      newRefundedAmount: 15n,
      newRevision: 5,
      publicationRequired: true,
    });
  });

  it.each([
    [10n, 3, 1, [{ ordinal: 3, unitValue: 4n }], 4n],
    [
      0n,
      2,
      2,
      [
        { ordinal: 2, unitValue: 0n },
        { ordinal: 1, unitValue: 0n },
      ],
      0n,
    ],
  ] as const)(
    'preserves remainder and zero for %s mills',
    (value, count, requested, selected, amount) => {
      const result = planPackageRefund({
        ...facts,
        slots: createPackageSlots(value, count),
        requestedSessions: requested,
      });
      expect(result).toEqual({
        accepted: true,
        selectedSlots: selected,
        amount,
        newRefundedAmount: 11n + amount,
        newRevision: 5,
        publicationRequired: true,
      });
    },
  );
});

describe('refund snapshot validation and immutability', () => {
  it('refuses insufficient count exactly and leaves frozen inputs unchanged', () => {
    const frozenSlots = Object.freeze(slots.map((slot) => Object.freeze({ ...slot })));
    const input = Object.freeze({ ...facts, slots: frozenSlots, requestedSessions: 3 });
    expect(() => planPackageRefund(input)).toThrow(new PackageRuleError('INSUFFICIENT_SLOTS'));
    expect(input).toEqual({ ...facts, slots, requestedSessions: 3 });
  });

  it.each([0, -1, 0.5])('propagates INVALID_SESSIONS for %s', (requestedSessions) => {
    expect(() => planPackageRefund({ ...facts, requestedSessions })).toThrow(
      new PackageRuleError('INVALID_SESSIONS'),
    );
  });

  it('returns fresh explicit copies from frozen snapshots with exact public keysets', () => {
    const frozenSlots = Object.freeze(slots.map((slot) => Object.freeze({ ...slot })));
    const input = Object.freeze({ ...facts, slots: frozenSlots });
    const result = planPackageRefund(input);
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error('Expected accepted refund');
    expect(Object.keys(result).sort()).toEqual([
      'accepted',
      'amount',
      'newRefundedAmount',
      'newRevision',
      'publicationRequired',
      'selectedSlots',
    ]);
    expect(result.selectedSlots).toEqual([
      { ordinal: 5, unitValue: 4n },
      { ordinal: 3, unitValue: 3n },
    ]);
    for (const selected of result.selectedSlots) {
      expect(Object.keys(selected).sort()).toEqual(['ordinal', 'unitValue']);
      expect(frozenSlots.some((slot) => slot === selected)).toBe(false);
    }
    expect(input).toEqual(facts);
    expect(planPackageRefund(input)).not.toBe(result);
  });
});

describe('branch-local expiry and provenance', () => {
  it.each(['2026-10-01', '2026-10-02'])(
    'accepts acting-branch date %s through the expiry day',
    (today) => {
      expect(planPackageRefund({ ...facts, today }).accepted).toBe(true);
    },
  );

  it('refuses after the branch expiry day until the supplied expiry is extended', () => {
    expect(() => planPackageRefund({ ...facts, today: '2026-10-03' })).toThrow(
      new PackageRuleError('PACKAGE_EXPIRED'),
    );
    expect(
      planPackageRefund({ ...facts, today: '2026-10-03', expiresOn: '2026-10-04' }).accepted,
    ).toBe(true);
  });

  it('propagates existing date validation', () => {
    expect(() => planPackageRefund({ ...facts, today: '2026-02-29' })).toThrow(
      new PackageRuleError('INVALID_DATE'),
    );
  });

  it('uses the same imported arithmetic with no PackageSaleChanged publication requirement', () => {
    const result = planPackageRefund({
      ...facts,
      provenance: 'IMPORTED',
      importedRefundsEnabled: true,
    });
    expect(result).toEqual({ ...planPackageRefund(facts), publicationRequired: false });
  });

  it('returns only the typed refusal for disabled imported refunds', () => {
    const input = Object.freeze({ ...facts, provenance: 'IMPORTED' as const });
    const result = planPackageRefund(input);
    expect(result).toEqual({ accepted: false, code: 'IMPORTED_REFUNDS_DISABLED' });
    expect(Object.keys(result).sort()).toEqual(['accepted', 'code']);
    expect(input).toEqual({ ...facts, provenance: 'IMPORTED' });
  });

  it.each([false, true])('SOLD always requires publication when imported flag is %s', (enabled) => {
    expect(planPackageRefund({ ...facts, importedRefundsEnabled: enabled })).toEqual(
      planPackageRefund(facts),
    );
  });
});

describe('existing Money and slot validation authorities', () => {
  it('accepts MONEY_MAX and increments revision once', () => {
    const result = planPackageRefund({
      ...facts,
      slots: createPackageSlots(MONEY_MAX, 1),
      requestedSessions: 1,
      refundedAmount: 0n,
    });
    expect(result).toEqual({
      accepted: true,
      selectedSlots: [{ ordinal: 1, unitValue: MONEY_MAX }],
      amount: MONEY_MAX,
      newRefundedAmount: MONEY_MAX,
      newRevision: 5,
      publicationRequired: true,
    });
  });

  it('propagates sumMoney overflow for entitlement state and selection totals', () => {
    expect(() => planPackageRefund({ ...facts, refundedAmount: MONEY_MAX })).toThrow(RangeError);
    const overflowingSlots: readonly PackageSlot[] = [
      { ordinal: 1, unitValue: MONEY_MAX, state: 'FREE' },
      { ordinal: 2, unitValue: 1n, state: 'FREE' },
    ];
    expect(() => planPackageRefund({ ...facts, slots: overflowingSlots })).toThrow(RangeError);
  });

  it('propagates named invalid stored price and duplicate ordinal refusals', () => {
    const invalidPriceSlots: readonly PackageSlot[] = [
      { ordinal: 1, unitValue: -1n, state: 'USED' },
    ];
    expect(() => planPackageRefund({ ...facts, slots: invalidPriceSlots })).toThrow(
      new PackageRuleError('INVALID_PRICE'),
    );
    const duplicate = { ordinal: 1, unitValue: 1n, state: 'FREE' as const };
    expect(() => planPackageRefund({ ...facts, slots: [duplicate, duplicate] })).toThrow(
      new PackageRuleError('INVALID_SLOTS'),
    );
  });
});
