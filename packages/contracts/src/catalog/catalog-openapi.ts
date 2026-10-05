import { serviceSchemas } from './service.js';

export { serviceSchemas };

const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});
const parameters = [
  {
    in: 'header',
    name: 'x-company-id',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  { in: 'path', name: 'businessId', required: true, schema: { type: 'string', format: 'uuid' } },
];
const serviceId = {
  in: 'path',
  name: 'serviceId',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
const errors = { description: 'Bilingual refusal', content: json('ErrorEnvelope') };

export const catalogPaths = {
  '/v1/businesses/{businessId}/services': {
    get: {
      operationId: 'listServices',
      description:
        'Cursor-paginated services of one business. Missing, foreign and other-business ids answer like unknown. Requires read:services:business and the catalog feature.',
      parameters: [
        ...parameters,
        { in: 'query', name: 'cursor', schema: { type: 'string', format: 'uuid' } },
        {
          in: 'query',
          name: 'limit',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      ],
      responses: {
        '200': { description: 'Service page', content: json('ServicePage') },
        default: errors,
      },
    },
    post: {
      operationId: 'createService',
      description:
        'Creates a business service with a KWD price and a commission rule. Requires manage:services:business and the catalog feature. Duplicate names are allowed; a zero price is allowed; a malformed rule or price returns a named 400. The write and its audit row commit in one transaction.',
      parameters,
      requestBody: { required: true, content: json('CreateServiceInput') },
      responses: {
        '201': { description: 'Created service', content: json('Service') },
        '400': errors,
        '404': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/services/{serviceId}': {
    get: {
      operationId: 'getService',
      description:
        'One service of the business. Missing, foreign and other-business ids share SERVICE_NOT_FOUND (404). Requires read:services:business and the catalog feature.',
      parameters: [...parameters, serviceId],
      responses: {
        '200': { description: 'Persisted service', content: json('Service') },
        '404': errors,
        default: errors,
      },
    },
    patch: {
      operationId: 'updateService',
      description:
        'Full replacement of the editable fields against expected_revision. Requires manage:services:business and the catalog feature. A price or rule change is audited; a stale revision returns SERVICE_REVISION_CONFLICT (409).',
      parameters: [...parameters, serviceId],
      requestBody: { required: true, content: json('UpdateServiceInput') },
      responses: {
        '200': { description: 'Updated service', content: json('Service') },
        '400': errors,
        '404': errors,
        '409': errors,
        default: errors,
      },
    },
  },
};
