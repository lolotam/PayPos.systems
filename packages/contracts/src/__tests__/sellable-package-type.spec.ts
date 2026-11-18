import { describe, expect, it } from 'vitest';
import {
  sellablePackageComponent,
  sellablePackageType,
  sellablePackageTypeListQuery,
  sellablePackageTypePage,
} from '../catalog/sellable-package-type.js';

const serviceId = '01920000-0000-7000-8000-000000000011';
const typeId = '01920000-0000-7000-8000-000000000012';
const nextId = '01920000-0000-7000-8000-000000000013';
const component = {
  service_id: serviceId,
  service_revision: 4,
  name_en: 'Synthetic service',
  name_ar: null,
  sessions: 10,
  list_price: '3.500',
};
const packageType = {
  id: typeId,
  revision: 2,
  name_en: 'Synthetic package',
  name_ar: 'باقة اختبار',
  price: '25.000',
  validity_days: 90,
  components: [component],
};

describe('sellable package type contract', () => {
  it('keeps the page, type and complete sale quote with decimal string money', () => {
    expect(sellablePackageComponent.parse(component)).toEqual(component);
    expect(sellablePackageType.parse(packageType)).toEqual(packageType);
    expect(sellablePackageTypePage.parse({ items: [packageType], next_cursor: nextId })).toEqual({
      items: [packageType],
      next_cursor: nextId,
    });
    expect(typeof packageType.price).toBe('string');
    expect(typeof component.list_price).toBe('string');
  });

  it.each([25000, '25000', '25.00', '025.000', '-1.000'])(
    'refuses non-canonical package money %s',
    (price) => {
      expect(sellablePackageType.safeParse({ ...packageType, price }).success).toBe(false);
    },
  );

  it('requires every component revision and list price for the stale-quote check', () => {
    expect(
      sellablePackageComponent.safeParse({ ...component, service_revision: undefined }).success,
    ).toBe(false);
    expect(sellablePackageComponent.safeParse({ ...component, list_price: 3.5 }).success).toBe(
      false,
    );
    expect(sellablePackageComponent.safeParse({ ...component, sessions: 0 }).success).toBe(false);
  });

  it('defaults and bounds the strict cursor query', () => {
    expect(sellablePackageTypeListQuery.parse({})).toEqual({ limit: 20 });
    expect(sellablePackageTypeListQuery.parse({ cursor: typeId, limit: '2' })).toEqual({
      cursor: typeId,
      limit: 2,
    });
    for (const query of [{ limit: 0 }, { limit: 101 }, { cursor: 'not-a-uuid' }, { extra: true }]) {
      expect(sellablePackageTypeListQuery.safeParse(query).success).toBe(false);
    }
  });
});
