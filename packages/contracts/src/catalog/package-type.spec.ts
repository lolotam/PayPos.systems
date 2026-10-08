import { expect, it } from 'vitest';
import {
  createPackageTypeInput,
  updatePackageTypeInput,
  packageTypeListQuery,
} from './package-type.js';

const id = '01920000-0000-7000-8000-000000000001';
const input = {
  name_en: 'Package',
  name_ar: null,
  price: '25.000',
  validity_days: 90,
  components: [{ service_id: id, sessions: 10 }],
};
it('accepts zero and maximum prices as strings, trims names and allows optional Arabic on create', () => {
  expect(
    createPackageTypeInput.parse({ ...input, name_en: ' Package ', price: '0.000' }).name_en,
  ).toBe('Package');
  expect(
    createPackageTypeInput.safeParse({ ...input, price: '99999999999.999', validity_days: 730 })
      .success,
  ).toBe(true);
});
it.each(['25.5', '-1.000', '100000000000.000', 'NaN', 25])('refuses wire price %s', (price) => {
  expect(createPackageTypeInput.safeParse({ ...input, price }).success).toBe(false);
});
it.each(['\tPackage', 'Package\n', 'a\u0001b'])('refuses controls before trimming %j', (name) => {
  expect(createPackageTypeInput.safeParse({ ...input, name_en: name }).success).toBe(false);
  expect(createPackageTypeInput.safeParse({ ...input, name_ar: name }).success).toBe(false);
});
it.each(['name_en', 'name_ar', 'price', 'validity_days', 'components', 'expected_revision'])(
  'update requires %s',
  (omitted) => {
    const body = Object.fromEntries(
      Object.entries({ ...input, expected_revision: 1 }).filter(([key]) => key !== omitted),
    );
    expect(updatePackageTypeInput.safeParse(body).success).toBe(false);
  },
);
it('rejects duplicate UUIDs regardless of case and refuses extra keys', () => {
  const serviceId = '01920000-0000-7000-8000-abcdef000001';
  expect(
    createPackageTypeInput.safeParse({
      ...input,
      components: [
        { service_id: serviceId, sessions: 1 },
        { service_id: serviceId.toUpperCase(), sessions: 2 },
      ],
    }).success,
  ).toBe(false);
  expect(createPackageTypeInput.safeParse({ ...input, is_active: false }).success).toBe(false);
});
it.each([0, 101, 1.5])('bounds list limit %s', (limit) => {
  expect(packageTypeListQuery.safeParse({ limit }).success).toBe(false);
});
