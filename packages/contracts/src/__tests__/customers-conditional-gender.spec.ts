import { describe, expect, it } from 'vitest';

import {
  findOrCreateCustomerInput,
  findOrCreateScopedCustomerInput,
} from '../customers.js';
import { buildOpenApiDocument } from '../openapi.js';

const input = {
  name: 'Example',
  phone: { calling_code: '1', national_number: '2025550123' },
  locale: 'ar',
};

describe('the conditional gender contract (34-pre-2)', () => {
  it('accepts an omitted gender on both strict lookups', () => {
    expect(findOrCreateCustomerInput.safeParse(input).success).toBe(true);
    expect(findOrCreateScopedCustomerInput.safeParse(input).success).toBe(true);
    expect(findOrCreateCustomerInput.parse(input)).not.toHaveProperty('gender');
  });

  it('takes only the two stored codes on both bodies', () => {
    for (const schema of [findOrCreateCustomerInput, findOrCreateScopedCustomerInput]) {
      for (const gender of ['female', 'male']) {
        expect(schema.safeParse({ ...input, gender }).success).toBe(true);
      }
      for (const gender of ['ذكر', 'other', '', null]) {
        expect(schema.safeParse({ ...input, gender }).success).toBe(false);
      }
    }
  });

  it('publishes the conditional rule on both bodies and all three writes', () => {
    const document = buildOpenApiDocument();
    const schemas = document['components'] as {
      schemas: Record<string, { description?: string }>;
    };
    for (const name of ['FindOrCreateCustomerInput', 'FindOrCreateScopedCustomerInput']) {
      expect(String(schemas.schemas[name]?.description)).toContain('new customer requires');
    }
    const paths = document['paths'] as Record<string, Record<string, { description?: string }>>;
    for (const path of [
      '/v1/customers/find-or-create',
      '/v1/businesses/{businessId}/customers/find-or-create',
      '/v1/branches/{branchId}/customers/find-or-create',
    ]) {
      expect(String(paths[path]?.['post']?.description)).toContain('legacy NULL');
    }
  });
});
