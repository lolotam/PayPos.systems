import { importedRefundsResponse, setImportedRefundsInput } from './imported-refunds.js';

// الـ schemas بتيجي من imported-refunds.ts مباشرة عشان Zod يتحول لـ __shared components.
export const importedRefundsSchemas = [setImportedRefundsInput, importedRefundsResponse];

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
const errors = { description: 'The API error envelope', content: json('ErrorEnvelope') };
const responses = () => ({
  '200': {
    description: 'The imported-package refunds switch of the business',
    content: json('ImportedRefundsResponse'),
  },
  default: errors,
});

export const importedRefundsPaths = {
  '/v1/businesses/{businessId}/settings/imported-refunds': {
    get: {
      operationId: 'getImportedRefunds',
      description:
        'Whether refunds of imported packages are enabled for the business. Requires manage:imported-refunds:business on that business; a caller without it, a settings-only holder, a device, another business and an unknown business are the same 403 FORBIDDEN. A business with no stored switch reads as off. Never writes.',
      parameters,
      responses: responses(),
    },
    put: {
      operationId: 'setImportedRefunds',
      description:
        'Turns refunds of imported packages on or off for the business. Requires manage:imported-refunds:business on that business, rechecked after the row lock so a revocation that commits first wins; every refusal is the same 403 FORBIDDEN. A write that does not change the effective value stores nothing and audits nothing; a changing write stores the value and one audit entry in the same transaction. No Idempotency-Key: a repeated value is a no-op.',
      parameters,
      requestBody: { required: true, content: json('SetImportedRefundsInput') },
      responses: responses(),
    },
  },
};
