import { expect, it } from 'vitest';

import { catalogPaths } from './catalog-openapi.js';
import { packageServiceOptionPage } from './package-service-option.js';

const option = {
  id: '01920000-0000-7000-8000-000000000001',
  name_en: 'Service',
  name_ar: null,
  price: '99999999999.999',
  active: true,
};

it('keeps exact KWD strings and only the package picker projection', () => {
  expect(
    packageServiceOptionPage.parse({
      items: [{ ...option, commission_rule: { kind: 'ZERO' }, counts_toward_threshold: true }],
      next_cursor: null,
    }),
  ).toEqual({ items: [option], next_cursor: null });
});

it.each([12.5, '12.5', '-1.000'])('refuses a non-contract price %s', (price) => {
  expect(
    packageServiceOptionPage.safeParse({
      items: [{ ...option, price }],
      next_cursor: null,
    }).success,
  ).toBe(false);
});

it('publishes the picker endpoint with its narrow response and package read dependency', () => {
  const route = catalogPaths['/v1/businesses/{businessId}/package-types/service-options'].get;
  expect(route.responses['200'].content['application/json'].schema.$ref).toBe(
    '#/components/schemas/PackageServiceOptionPage',
  );
  expect(route.description).toContain('Requires read:package-types:business');
  expect(route.description).toContain(
    'A role that manages package types also needs read:package-types:business',
  );
});
