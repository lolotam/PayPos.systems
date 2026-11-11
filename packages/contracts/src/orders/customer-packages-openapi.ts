import { json } from '../openapi-operation.js';

const parameters = [
  {
    in: 'header',
    name: 'x-company-id',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  { in: 'path', name: 'businessId', required: true, schema: { type: 'string', format: 'uuid' } },
  { in: 'path', name: 'branchId', required: true, schema: { type: 'string', format: 'uuid' } },
  { in: 'path', name: 'customerId', required: true, schema: { type: 'string', format: 'uuid' } },
];
const refusal = { description: 'Bilingual refusal', content: json('ErrorEnvelope') };
const guard =
  'Requires record:service-sessions:branch or read:service-sessions:branch, and the orders feature.';

export const customerPackagePaths = {
  '/v1/businesses/{businessId}/branches/{branchId}/customers/{customerId}/packages': {
    get: {
      operationId: 'listCustomerPackages',
      description: `${guard} Lists the customer's packages, usable first, without customer phone data.`,
      parameters: [
        ...parameters,
        { in: 'query', name: 'cursor', required: false, schema: { type: 'string' } },
        { in: 'query', name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
      ],
      responses: {
        '200': { description: 'Customer package page', content: json('CustomerPackagePage') },
        '400': refusal,
        '403': refusal,
        '404': refusal,
        default: refusal,
      },
    },
  },
  '/v1/businesses/{businessId}/branches/{branchId}/customers/{customerId}/packages/{entitlementId}': {
    get: {
      operationId: 'customerPackageDetail',
      description: `${guard} Returns stored sale facts, components and slots; unknown or inaccessible packages share PACKAGE_NOT_FOUND.`,
      parameters: [
        ...parameters,
        { in: 'path', name: 'entitlementId', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        '200': { description: 'Customer package detail', content: json('CustomerPackageDetail') },
        '403': refusal,
        '404': { description: 'PACKAGE_NOT_FOUND', content: json('ErrorEnvelope') },
        default: refusal,
      },
    },
  },
};
