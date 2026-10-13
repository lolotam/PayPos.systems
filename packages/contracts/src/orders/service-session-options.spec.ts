import { expect, it } from 'vitest';
import { sessionServiceOption, sessionServiceOptionPage, sessionServiceOptionsQuery } from './service-session-options.js';
import { serviceSessionFormPaths } from './service-session-form-openapi.js';

const id = '00000000-0000-7000-8000-000000000001';
const option = { id, name_ar: null, name_en: 'Synthetic service', price: '7.125', revision: 2 };
it('documents the guarded limited GET, UUID cursor, page bounds and response schema', () => {
  const route = serviceSessionFormPaths['/v1/businesses/{businessId}/branches/{branchId}/service-sessions/service-options'].get;
  expect(route.description).toContain('record:service-sessions:branch');
  expect(route.parameters.find((p) => p.name === 'limit')?.schema).toEqual({ type: 'integer', minimum: 1, maximum: 100, default: 20 });
  expect(route.parameters.map((p) => p.name)).toEqual(['x-company-id', 'businessId', 'branchId', 'cursor', 'limit']);
  expect(route.responses['200'].content['application/json'].schema.$ref).toBe('#/components/schemas/SessionServiceOptionPage');
});
it('accepts only bounded UUID cursor queries with the established defaults', () => {
  expect(sessionServiceOptionsQuery.parse({})).toEqual({ limit: 20 });
  expect(sessionServiceOptionsQuery.parse({ cursor: id.toUpperCase(), limit: '100' })).toEqual({ cursor: id, limit: 100 });
  for (const query of [{ cursor: 'bad' }, { limit: '0' }, { limit: '101' }, { limit: '1.5' }, { business_id: id }])
    expect(sessionServiceOptionsQuery.safeParse(query).success).toBe(false);
});
it('keeps exact canonical prices and rejects wider/private fields and malformed pages', () => {
  for (const price of ['0.000', '7.125', '99999999999.999'])
    expect(sessionServiceOption.parse({ ...option, price }).price).toBe(price);
  for (const fields of [{ price: 7.125 }, { price: '7.12' }, { price: '-1.000' }, { revision: 0 },
    { commission_rule: { kind: 'ZERO' } }, { counts_toward_threshold: true }, { business_id: id }])
    expect(sessionServiceOption.safeParse({ ...option, ...fields }).success).toBe(false);
  expect(sessionServiceOptionPage.parse({ items: [option], next_cursor: null })).toEqual({ items: [option], next_cursor: null });
  expect(sessionServiceOptionPage.safeParse({ items: [], next_cursor: 'bad' }).success).toBe(false);
  expect(sessionServiceOptionPage.safeParse({ items: [], next_cursor: null, total: 0 }).success).toBe(false);
});
