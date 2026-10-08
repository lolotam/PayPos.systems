import { expect, it } from 'vitest';
import { packageDefinitionCases } from '../../../../../test/package-definition-cases.ts';
import {
  newPackageType,
  packageTypeSnapshot,
  packageTypeTerms,
  packageTypeView,
  planPackageTypeUpdate,
  validatePackageTypeDraft,
  type PackageTypeTerms,
} from '../package-type.ts';

const base: PackageTypeTerms = {
  name_en: 'Package',
  name_ar: null,
  price: 25000n,
  validity_days: 90,
  components: [{ service_id: 'a', sessions: 10 }],
};
const at = new Date('2026-10-08T10:00:00Z');

it.each(packageDefinitionCases)('shared definition: $name', ({ price, components, error }) => {
  const check = () =>
    validatePackageTypeDraft({
      ...base,
      price,
      components: components.map((c) => ({ service_id: c.serviceId, sessions: c.sessions })),
    });
  if (error === null) expect(check).not.toThrow();
  else
    expect(check).toThrow(
      error === 'INVALID_PRICE' ? 'PACKAGE_TYPE_PRICE_INVALID' : `PACKAGE_TYPE_${error}`,
    );
});

it.each([0, 731, 1.5, NaN, Infinity])('rejects validity %s', (validity_days) => {
  expect(() => validatePackageTypeDraft({ ...base, validity_days })).toThrow(
    'PACKAGE_TYPE_VALIDITY_INVALID',
  );
});
it.each([1, 730])('accepts validity %s', (validity_days) => {
  expect(() => validatePackageTypeDraft({ ...base, validity_days })).not.toThrow();
});
it.each([1, 20, 21])('component cap %s', (count) => {
  const components = Array.from({ length: count }, (_, i) => ({
    service_id: String(i),
    sessions: 1,
  }));
  const check = () => validatePackageTypeDraft({ ...base, components });
  if (count > 20) expect(check).toThrow('PACKAGE_TYPE_INVALID_COMPONENTS');
  else expect(check).not.toThrow();
});
it.each(['', ' ', 'x'.repeat(256), 'a\u0001b'])('rejects invalid name %j', (name) => {
  expect(() => validatePackageTypeDraft({ ...base, name_en: name })).toThrow(
    'PACKAGE_TYPE_NAME_INVALID',
  );
  expect(() => validatePackageTypeDraft({ ...base, name_ar: name })).toThrow(
    'PACKAGE_TYPE_NAME_INVALID',
  );
});
it('trims names and normalizes UUID spelling without changing input', () => {
  const input = {
    ...base,
    name_en: ' Package ',
    name_ar: ' باقة ',
    price: '25.000',
    expected_revision: 1,
    components: [{ service_id: 'ABCD', sessions: 1 }],
  };
  expect(packageTypeTerms(input)).toMatchObject({
    name_en: 'Package',
    name_ar: 'باقة',
    price: 25000n,
    components: [{ service_id: 'abcd', sessions: 1 }],
  });
  expect(input.name_en).toBe(' Package ');
  expect(packageTypeTerms(input)).not.toHaveProperty('expected_revision');
  expect(() => validatePackageTypeDraft({ ...base, name_en: 'x'.repeat(255) })).not.toThrow();
});
it.each(['-1.000', '25.5', '100000000000.000', 'NaN'])('rejects wire price %s', (price) => {
  expect(() => packageTypeTerms({ ...base, price })).toThrow('PACKAGE_TYPE_PRICE_INVALID');
});
it.each(['\tPackage', 'Package\n'])('rejects controls before trimming %j', (name) => {
  expect(() => packageTypeTerms({ ...base, price: '25.000', name_en: name })).toThrow(
    'PACKAGE_TYPE_NAME_INVALID',
  );
  expect(() => packageTypeTerms({ ...base, price: '25.000', name_ar: name })).toThrow(
    'PACKAGE_TYPE_NAME_INVALID',
  );
});
it('detects no-op, stale revision and each editable change including component order', () => {
  const current = newPackageType(
    { ...base, components: [...base.components, { service_id: 'b', sessions: 1 }] },
    'id',
    'business',
    at,
  );
  expect(planPackageTypeUpdate(current, current, 1, at)).toEqual({
    after: current,
    changed: false,
  });
  expect(() => planPackageTypeUpdate(current, current, 2, at)).toThrow(
    'PACKAGE_TYPE_REVISION_CONFLICT',
  );
  for (const change of [
    { price: 0n },
    { name_en: 'New' },
    { name_ar: 'جديد' },
    { validity_days: 1 },
    { components: [...current.components].reverse() },
    { components: [{ service_id: 'a', sessions: 1 }] },
  ]) {
    const result = planPackageTypeUpdate(current, { ...current, ...change }, 1, at);
    expect(result.changed).toBe(true);
    expect(result.after.revision).toBe(2);
  }
  expect(current.revision).toBe(1);
});
it('serializes money exactly, accepts free services and rejects missing service facts', () => {
  const record = newPackageType(base, 'id', 'business', at);
  expect(packageTypeSnapshot(record).price).toBe('25.000');
  expect(
    packageTypeView(record, [{ service_id: 'a', name_en: 'Free', name_ar: null, price: '0.000' }])
      .components[0]?.price,
  ).toBe('0.000');
  expect(() => packageTypeView(record, [])).toThrow('PACKAGE_TYPE_SERVICE_NOT_FOUND');
});
