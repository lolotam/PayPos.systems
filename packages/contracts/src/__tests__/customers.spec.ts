import { describe, expect, it } from 'vitest';

import { customer, findOrCreateCustomerInput } from '../customers.js';
import { buildOpenApiDocument } from '../openapi.js';

const input = {
  name: 'Example',
  phone: { calling_code: '1', national_number: '2025550123' },
  locale: 'ar',
};
const response = {
  id: '01920000-0000-7000-8000-000000000abc',
  name: 'Example',
  phone: '***123',
  locale: 'ar',
  opted_out: false,
};

describe('customer contracts', () => {
  it('requires explicit locale and strips surrounding name whitespace', () => {
    expect(findOrCreateCustomerInput.parse({ ...input, name: ' Example ' })).toEqual(input);
    expect(findOrCreateCustomerInput.safeParse({ ...input, locale: 'en' }).success).toBe(true);
  });

  it.each([
    { ...input, phone: '2025550123' },
    ...['', '+1', '01', '1234', '1\n', '١'].map((calling_code) => ({
      ...input,
      phone: { ...input.phone, calling_code },
    })),
    ...['', '202 5550123', '2025550123\n', '+2025550123', '٢٠٢٥٥٥٠١٢٣', '2'.repeat(65)].map(
      (national_number) => ({ ...input, phone: { ...input.phone, national_number } }),
    ),
    { ...input, phone: { calling_code: '965' } },
    { ...input, phone: { ...input.phone, country: 'US' } },
    { ...input, phone: null },
    { ...input, locale: 'fr' },
    { name: input.name, phone: input.phone },
    { ...input, name: ' ' },
    { ...input, name: 'a'.repeat(201) },
    { ...input, company_id: response.id },
    { ...input, opted_out: false },
  ])('refuses invalid or client-selected scope: %j', (body) => {
    expect(findOrCreateCustomerInput.safeParse(body).success).toBe(false);
  });

  it('response accepts only masked phone and no internal or extra fields', () => {
    expect(customer.parse(response)).toEqual(response);
    for (const phone of ['+12025550123', input.phone, '12025550123', '***123\n']) {
      expect(customer.safeParse({ ...response, phone }).success).toBe(false);
    }
    expect(customer.safeParse({ ...response, opted_out_at: null }).success).toBe(false);
    expect(customer.safeParse({ ...response, phone: '***12' }).success).toBe(true);
  });

  it('accepts explicit country and digit-only national zeros without normalizing in the contract', () => {
    const phone = { calling_code: '965', national_number: '00012345678' };
    expect(findOrCreateCustomerInput.parse({ ...input, phone }).phone).toEqual(phone);
  });

  it('OpenAPI publishes the guarded operation with HTTP 200 and selected company header', () => {
    const paths = buildOpenApiDocument()['paths'] as Record<
      string,
      { post: Record<string, unknown> }
    >;
    expect(paths['/v1/customers/find-or-create']?.post).toMatchObject({
      operationId: 'findOrCreateCustomer',
      parameters: [{ name: 'x-company-id', in: 'header', required: true }],
      responses: {
        '200': {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Customer' } } },
        },
      },
    });
  });
});
