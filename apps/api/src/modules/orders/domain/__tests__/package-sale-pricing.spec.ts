import { MONEY_MAX, type Money } from '@pospay/domain';
import { describe, expect, it } from 'vitest';

import { PackageRuleError } from '../errors.ts';
import { PackageSalePricingError, computePackageSalePricing } from '../package-sale-pricing.ts';

/** يمسك سبب الرفض بدل ما الاختبار يعدّي على إن الكود رمي. */
function captureRefusal(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('the sale should have been refused');
}

describe('package sale pricing: the discount against the type price (FR-012)', () => {
  const freeAndAboveList: [Money, Money, number][] = [
    [0n, 0n, 0],
    [0n, 500n, 0],
    [25000n, 25000n, 0],
    [25000n, 27000n, 0],
  ];

  it.each(freeAndAboveList)(
    'type %s paid %s discounts nothing and counts %s bps',
    (typePrice, pricePaid, discountBps) => {
      const priced = computePackageSalePricing({ typePrice, pricePaid, limitBps: 0 });
      expect(priced).toEqual({ discount: 0n, discountBps });
    },
  );

  it('discounts the difference and rounds the bps up to the next mill', () => {
    const exact = computePackageSalePricing({
      typePrice: 25000n,
      pricePaid: 22500n,
      limitBps: 1000,
    });
    expect(exact).toEqual({ discount: 2500n, discountBps: 1000 });
    const onTheCeiling = computePackageSalePricing({
      typePrice: 7125n,
      pricePaid: 6413n,
      limitBps: 1000,
    });
    expect(onTheCeiling).toEqual({ discount: 712n, discountBps: 1000 });
    const oneMillOver = computePackageSalePricing({
      typePrice: 7125n,
      pricePaid: 6412n,
      limitBps: 1001,
    });
    expect(oneMillOver).toEqual({ discount: 713n, discountBps: 1001 });
  });

  it('keeps the money exact on the largest storable amount', () => {
    const almostFree = computePackageSalePricing({
      typePrice: MONEY_MAX,
      pricePaid: MONEY_MAX - 1n,
      limitBps: null,
    });
    expect(almostFree).toEqual({ discount: 1n, discountBps: 1 });
    const free = computePackageSalePricing({
      typePrice: MONEY_MAX,
      pricePaid: 0n,
      limitBps: 10000,
    });
    expect(free).toEqual({ discount: MONEY_MAX, discountBps: 10000 });
    const priced = computePackageSalePricing({
      typePrice: 25000n,
      pricePaid: 22500n,
      limitBps: 1000,
    });
    expect(typeof priced.discount).toBe('bigint');
    expect(typeof priced.discountBps).toBe('number');
  });
});

describe('package sale pricing: the recorder limit (FR-013)', () => {
  it('lets an unlimited recorder sell at nothing', () => {
    const free = computePackageSalePricing({ typePrice: 25000n, pricePaid: 0n, limitBps: null });
    expect(free).toEqual({ discount: 25000n, discountBps: 10000 });
  });

  it('accepts a discount on the limit and refuses one mill above it', () => {
    const onTheLimit = computePackageSalePricing({
      typePrice: 7125n,
      pricePaid: 6413n,
      limitBps: 1000,
    });
    expect(onTheLimit).toEqual({ discount: 712n, discountBps: 1000 });
    const refused = captureRefusal(() =>
      computePackageSalePricing({ typePrice: 7125n, pricePaid: 6412n, limitBps: 1000 }),
    );
    expect(refused).toBeInstanceOf(PackageSalePricingError);
    expect((refused as PackageSalePricingError).code).toBe('PACKAGE_SALE_DISCOUNT_ABOVE_LIMIT');
    expect((refused as PackageSalePricingError).details).toEqual({
      limitBps: 1000,
      discountBps: 1001,
    });
  });

  it('refuses a 16% sale under a 10% limit with nothing written (SA-04)', () => {
    const refused = captureRefusal(() =>
      computePackageSalePricing({ typePrice: 25000n, pricePaid: 21000n, limitBps: 1000 }),
    );
    expect(refused).toBeInstanceOf(PackageSalePricingError);
    expect((refused as PackageSalePricingError).code).toBe('PACKAGE_SALE_DISCOUNT_ABOVE_LIMIT');
    expect((refused as PackageSalePricingError).details).toEqual({
      limitBps: 1000,
      discountBps: 1600,
    });
  });

  it('holds a zero limit to a zero discount only', () => {
    const noDiscount = computePackageSalePricing({
      typePrice: 25000n,
      pricePaid: 25000n,
      limitBps: 0,
    });
    expect(noDiscount).toEqual({ discount: 0n, discountBps: 0 });
    expect(() =>
      computePackageSalePricing({ typePrice: 25000n, pricePaid: 24999n, limitBps: 0 }),
    ).toThrow(PackageSalePricingError);
  });

  it('accepts every discount under a full limit', () => {
    const free = computePackageSalePricing({ typePrice: 25000n, pricePaid: 0n, limitBps: 10000 });
    expect(free).toEqual({ discount: 25000n, discountBps: 10000 });
  });

  it.each([-1, 10001, 1.5, NaN, Infinity, '1000' as unknown as number])(
    'refuses the malformed limit %s instead of counting a wrong bps',
    (limitBps) => {
      const refused = captureRefusal(() =>
        computePackageSalePricing({ typePrice: 25000n, pricePaid: 25000n, limitBps }),
      );
      expect(refused).toBeInstanceOf(PackageSalePricingError);
      expect((refused as PackageSalePricingError).code).toBe('INVALID_LIMIT');
    },
  );
});

describe('package sale pricing: the money of the sale', () => {
  const invalidMoney: Money[] = [-1n, MONEY_MAX + 1n, -MONEY_MAX - 1n, 1 as unknown as bigint];

  it.each(invalidMoney)('refuses the type price %s by the shared money rule', (typePrice) => {
    expect(() =>
      computePackageSalePricing({ typePrice, pricePaid: 1000n, limitBps: null }),
    ).toThrow(PackageRuleError);
    expect(() =>
      computePackageSalePricing({ typePrice, pricePaid: 1000n, limitBps: null }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_PRICE' }));
  });

  it.each(invalidMoney)('refuses the paid amount %s by the shared money rule', (pricePaid) => {
    expect(() =>
      computePackageSalePricing({ typePrice: 25000n, pricePaid, limitBps: null }),
    ).toThrow(PackageRuleError);
    expect(() =>
      computePackageSalePricing({ typePrice: 25000n, pricePaid, limitBps: null }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_PRICE' }));
  });

  it('refuses the money before the limit is looked at', () => {
    expect(() =>
      computePackageSalePricing({ typePrice: -1n, pricePaid: -1n, limitBps: 0 }),
    ).toThrow(new PackageRuleError('INVALID_PRICE'));
  });
});

describe('package sale pricing: the input stays untouched', () => {
  it('answers with a new object and leaves the frozen input as it was', () => {
    const input = Object.freeze({ typePrice: 25000n, pricePaid: 22500n, limitBps: 1000 });
    const result = computePackageSalePricing(input);
    expect(result).toEqual({ discount: 2500n, discountBps: 1000 });
    expect(result).not.toBe(input);
    expect(input).toEqual({ typePrice: 25000n, pricePaid: 22500n, limitBps: 1000 });
    expect(Object.isFrozen(input)).toBe(true);
  });
});
