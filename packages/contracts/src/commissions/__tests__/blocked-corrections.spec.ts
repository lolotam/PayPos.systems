import { expect, it } from 'vitest';

import { buildOpenApiDocument } from '../../openapi.js';

const path = '/v1/businesses/{businessId}/commission-blocked-corrections';

interface Operation {
  operationId?: string;
  parameters?: {
    name?: string;
    in?: string;
    required?: boolean;
    description?: string;
    schema?: unknown;
  }[];
  responses?: Record<
    string,
    { description?: string; content?: Record<string, { schema?: unknown }> }
  >;
}

const document = buildOpenApiDocument();
const paths = document['paths'] as Record<string, Record<string, Operation>>;
const operation = paths[path]?.['get'];

it('publishes the list under its settled operation id', () => {
  expect(operation?.operationId).toBe('listCommissionBlockedCorrections');
});

it('makes the company header optional and names the session company fallback', () => {
  const company = operation?.parameters?.find((parameter) => parameter.name === 'x-company-id');
  expect(company).toMatchObject({ in: 'header', required: false });
  expect(company?.description).toContain('session');
  expect(company?.description).toContain('403 FORBIDDEN');
});

it('keeps the business path parameter required', () => {
  const business = operation?.parameters?.find((parameter) => parameter.name === 'businessId');
  expect(business).toMatchObject({ in: 'path', required: true });
});

it('publishes the list envelope for the page and the error envelope for the refusals', () => {
  expect(operation?.responses?.['200']?.content?.['application/json']?.schema).toEqual({
    $ref: '#/components/schemas/CommissionBlockedCorrectionList',
  });
  expect(operation?.responses?.['403']?.content?.['application/json']?.schema).toEqual({
    $ref: '#/components/schemas/ErrorEnvelope',
  });
});
