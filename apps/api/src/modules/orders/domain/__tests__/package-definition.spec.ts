import { MONEY_MAX } from '@pospay/domain';
import { describe, expect, it } from 'vitest';

import { PackageRuleError } from '../errors.js';
import { allocatePackagePrice } from '../package-allocation.js';
import { validatePackageDefinition, validatePackagePrice } from '../package-definition.js';
import { createPackageSlots } from '../package-slots.js';

const component = { serviceId: 'a', sessions: 3, listPriceSnapshot: 1n };

describe('shared type/sale/import validation (PKG-06/11)', () => {
  it.each([0n, 1n, MONEY_MAX])('accepts nonnegative price %s', (price) => {
    expect(validatePackagePrice(price)).toBe(price);
    expect(() => validatePackageDefinition(price, [component])).not.toThrow();
  });

  it.each([-1n, MONEY_MAX + 1n, -MONEY_MAX - 1n, 1 as unknown as bigint])(
    'rejects invalid money %s by name',
    (price) => {
      expect(() => validatePackagePrice(price)).toThrow(new PackageRuleError('INVALID_PRICE'));
      expect(() => allocatePackagePrice(price, [component])).toThrow(PackageRuleError);
      expect(() => createPackageSlots(price, 3)).toThrow(PackageRuleError);
    },
  );

  it('requires at least one component with a service id', () => {
    expect(() => validatePackageDefinition(0n, [])).toThrow(
      new PackageRuleError('INVALID_COMPONENTS'),
    );
    expect(() => allocatePackagePrice(0n, [])).toThrow(PackageRuleError);
    expect(() => validatePackageDefinition(0n, [{ serviceId: '', sessions: 1 }])).toThrow(
      new PackageRuleError('INVALID_COMPONENTS'),
    );
  });

  it('rejects a duplicate service even when its session count differs', () => {
    expect(() => validatePackageDefinition(1n, [component, { ...component, sessions: 1 }])).toThrow(
      new PackageRuleError('DUPLICATE_SERVICE'),
    );
  });

  it.each([0, -1, 1.5, NaN, Infinity, 366, 4_294_967_296, Number.MAX_SAFE_INTEGER + 1])(
    'rejects original sessions %s',
    (sessions) => {
      expect(() => validatePackageDefinition(1n, [{ ...component, sessions }])).toThrow(
        new PackageRuleError('INVALID_SESSIONS'),
      );
      expect(() => createPackageSlots(1n, sessions)).toThrow(PackageRuleError);
    },
  );

  it('accepts the 365-session maximum and conserves its value', () => {
    const slots = createPackageSlots(1_000n, 365);
    expect(slots).toHaveLength(365);
    expect(slots.reduce((sum, slot) => sum + slot.unitValue, 0n)).toBe(1_000n);
    expect(slots[0]?.unitValue).toBe(2n);
    expect(slots[364]?.unitValue).toBe(272n);
  });

  it.each([-1, 4, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects remaining sessions %s',
    (remainingSessions) => {
      expect(() => validatePackageDefinition(1n, [{ ...component, remainingSessions }])).toThrow(
        new PackageRuleError('INVALID_REMAINING_SESSIONS'),
      );
      expect(() => createPackageSlots(1n, 3, remainingSessions)).toThrow(PackageRuleError);
    },
  );
});

describe('snapshot price validation and named error contract', () => {
  it.each([-1n, MONEY_MAX + 1n, 1 as unknown as bigint])(
    'rejects invalid list price %s even on a free package',
    (listPriceSnapshot) => {
      expect(() => allocatePackagePrice(0n, [{ ...component, listPriceSnapshot }])).toThrow(
        new PackageRuleError('INVALID_PRICE'),
      );
    },
  );

  it('exposes a stable error name and code without an HTTP dependency', () => {
    const error = new PackageRuleError('INSUFFICIENT_SLOTS');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PackageRuleError');
    expect(error.code).toBe('INSUFFICIENT_SLOTS');
  });
});
