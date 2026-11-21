import { describe, expect, it } from 'vitest';

import {
  componentName,
  packageName,
  paidMethodKey,
  packageMoney,
  parsePackageRouteId,
  provenanceKey,
  slotLabelKey,
} from './customer-package-view';

describe('parsePackageRouteId', () => {
  const uuid = '01920000-0000-7000-8000-0000000000d1';
  it('accepts a uuid and lowercases it', () => {
    expect(parsePackageRouteId(uuid.toUpperCase())).toBe(uuid);
  });
  it.each(['', 'not-a-uuid', '12345', `${uuid}/../evil`, null, undefined])(
    'refuses %j without a valid id',
    (raw) => {
      expect(parsePackageRouteId(raw as string | null | undefined)).toBeNull();
    },
  );
});

it('the package name falls back from Arabic to English', () => {
  expect(packageName('ar', { name_en: 'Gold', name_ar: 'ذهبية' })).toBe('ذهبية');
  expect(packageName('ar', { name_en: 'Gold', name_ar: null })).toBe('Gold');
  expect(packageName('en', { name_en: 'Gold', name_ar: 'ذهبية' })).toBe('Gold');
});

it('the component name follows the same fallback', () => {
  expect(componentName('ar', { name_en: 'Hair', name_ar: 'شعر' })).toBe('شعر');
  expect(componentName('en', { name_en: 'Hair', name_ar: null })).toBe('Hair');
});

it('provenance and slot states map to their label keys', () => {
  expect(provenanceKey('SOLD')).toBe('customerPackages.sold');
  expect(provenanceKey('IMPORTED')).toBe('customerPackages.imported');
  expect(slotLabelKey('FREE')).toBe('customerPackages.slotFree');
  expect(slotLabelKey('USED')).toBe('customerPackages.slotUsed');
  expect(slotLabelKey('REFUNDED')).toBe('customerPackages.slotRefunded');
  expect(slotLabelKey('IMPORTED_USED')).toBe('customerPackages.slotImportedUsed');
});

it('the paid method maps to the sale labels and null stays null', () => {
  expect(paidMethodKey('CASH')).toBe('packageSale.cash');
  expect(paidMethodKey('CARD')).toBe('packageSale.card');
  expect(paidMethodKey(null)).toBeNull();
});

it('packageMoney formats the three-decimal string for display', () => {
  expect(packageMoney('12.500')).toBe('12.500');
  expect(packageMoney('0.000')).toBe('0.000');
});
