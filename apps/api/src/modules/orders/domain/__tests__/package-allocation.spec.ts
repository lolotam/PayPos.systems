import { MONEY_MAX, roundKwd, sumMoney } from '@pospay/domain';
import { describe, expect, it } from 'vitest';

import { allocatePackagePrice } from '../package-allocation.js';
import { createPackageSlots } from '../package-slots.js';
import { allocationFixtures } from './fixtures/package-allocation.js';

describe('package allocation hand-calculated fixtures (PKG-01…04)', () => {
  it.each(allocationFixtures)('$name', (fixture) => {
    const result = allocatePackagePrice(fixture.pricePaid, fixture.components);
    expect(result.map((component) => component.componentValue)).toEqual(fixture.expectedValues);
    expect(
      result.map((component) =>
        createPackageSlots(component.componentValue, component.sessions).map(
          (slot) => slot.unitValue,
        ),
      ),
    ).toEqual(fixture.expectedSlots);
    expect(sumMoney(result.map((component) => component.componentValue))).toBe(fixture.pricePaid);
  });

  it('uses exact remainder ranking before the service-id tiebreak', () => {
    const result = allocatePackagePrice(2n, [
      { serviceId: 'a', sessions: 1, listPriceSnapshot: 1n },
      { serviceId: 'z', sessions: 1, listPriceSnapshot: 2n },
    ]);
    expect(result.map((component) => component.componentValue)).toEqual([1n, 1n]);
  });

  it('does not independently round proportional shares at a half (ADR-0005)', () => {
    expect(roundKwd(1n, 2n)).toBe(1n);
    const components = ['b', 'a'].map((serviceId) => ({
      serviceId,
      sessions: 1,
      listPriceSnapshot: 1n,
    }));
    expect(allocatePackagePrice(1n, components).map((item) => item.componentValue)).toEqual([
      0n,
      1n,
    ]);
  });

  it('zero payment makes all components and slots zero', () => {
    for (const fixture of allocationFixtures) {
      const result = allocatePackagePrice(0n, fixture.components);
      expect(result.every((component) => component.componentValue === 0n)).toBe(true);
      expect(
        result
          .flatMap((component) => createPackageSlots(0n, component.sessions))
          .every((slot) => slot.unitValue === 0n),
      ).toBe(true);
    }
  });
});

describe('package allocation precision and original snapshots', () => {
  it('single component retains the exact payment, including MONEY_MAX', () => {
    for (const pricePaid of [0n, 1n, 10_001n, MONEY_MAX]) {
      const result = allocatePackagePrice(pricePaid, [
        { serviceId: 'a', sessions: 3, listPriceSnapshot: MONEY_MAX },
      ]);
      expect(result[0]?.componentValue).toBe(pricePaid);
      expect(sumMoney(createPackageSlots(pricePaid, 3).map((slot) => slot.unitValue))).toBe(
        pricePaid,
      );
    }
  });

  it('weights and products exceed the money range without float conversion', () => {
    const result = allocatePackagePrice(MONEY_MAX, [
      { serviceId: 'a', sessions: Number.MAX_SAFE_INTEGER, listPriceSnapshot: MONEY_MAX },
      { serviceId: 'b', sessions: Number.MAX_SAFE_INTEGER, listPriceSnapshot: MONEY_MAX },
    ]);
    expect(result.map((component) => component.componentValue)).toEqual([
      50_000_000_000_000n,
      49_999_999_999_999n,
    ]);
  });

  it('import remaining counts do not affect original allocation (PKG-05)', () => {
    const original = allocationFixtures[0];
    const imported = original.components.map((component) => ({
      ...component,
      remainingSessions: 0,
    }));
    expect(
      allocatePackagePrice(original.pricePaid, imported).map((item) => item.componentValue),
    ).toEqual(original.expectedValues);
  });

  it('does not mutate input and returns independent objects', () => {
    const components = Object.freeze(
      allocationFixtures[0].components.map((item) => Object.freeze({ ...item })),
    );
    const result = allocatePackagePrice(10_001n, components);
    expect(result[0]).not.toBe(components[0]);
    expect(components).toEqual(allocationFixtures[0].components);
  });
});

describe('bounded exhaustive conservation and input-order invariance', () => {
  it('conserves each mill for all tiny two-component weights and sessions', () => {
    for (let paid = 0n; paid <= 15n; paid++) {
      for (let priceA = 0n; priceA <= 3n; priceA++) {
        for (let priceB = 0n; priceB <= 3n; priceB++) {
          for (const sessions of [1, 2, 3]) {
            const components = [
              { serviceId: 'b', sessions, listPriceSnapshot: priceB },
              { serviceId: 'a', sessions: 2, listPriceSnapshot: priceA },
            ];
            const result = allocatePackagePrice(paid, components);
            const reversed = allocatePackagePrice(paid, [...components].reverse()).reverse();
            expect(result).toEqual(reversed);
            expect(sumMoney(result.map((component) => component.componentValue))).toBe(paid);
            const slots = result.flatMap((item) =>
              createPackageSlots(item.componentValue, item.sessions),
            );
            expect(sumMoney(slots.map((slot) => slot.unitValue))).toBe(paid);
            expect(slots.every((slot) => slot.unitValue >= 0n)).toBe(true);
          }
        }
      }
    }
  });

  it('all six permutations preserve a three-way tied allocation', () => {
    for (const ids of ['abc', 'acb', 'bac', 'bca', 'cab', 'cba']) {
      const components = [...ids].map((serviceId) => ({
        serviceId,
        sessions: 1,
        listPriceSnapshot: 0n,
      }));
      const result = allocatePackagePrice(2n, components);
      expect(
        Object.fromEntries(result.map((item) => [item.serviceId, item.componentValue])),
      ).toEqual({ a: 1n, b: 1n, c: 0n });
    }
  });
});
