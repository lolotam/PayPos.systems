import { z } from 'zod';
import { employeeNumberView, setEmployeeNumberInput } from './employee-number.js';

const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});
const bodyJson = (schema: typeof employeeNumberView | typeof setEmployeeNumberInput) => ({
  'application/json': {
    schema: z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input', metadata: z.registry() }),
  },
});
const parameters = [
  { in: 'header', name: 'x-company-id', required: true, schema: { type: 'string', format: 'uuid' } },
  ...['businessId', 'employeeId'].map((name) => ({
    in: 'path',
    name,
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })),
];
const errors = { description: 'Bilingual refusal', content: json('ErrorEnvelope') };

export const employeeNumberPaths = {
  '/v1/businesses/{businessId}/employees/{employeeId}/employee-number': {
    put: {
      operationId: 'setEmployeeNumber',
      parameters,
      description:
        'Human manage:employee-number:company. Sets one employee number in the company. A DENY on her business, primary branch, or any current attachment blocks. The same number is a no-op. A hand edit does not move the company counter. No Idempotency-Key.',
      requestBody: { required: true, content: bodyJson(setEmployeeNumberInput) },
      responses: {
        '200': { description: 'The stored employee number', content: bodyJson(employeeNumberView) },
        '400': errors,
        '403': errors,
        '404': errors,
        '409': errors,
      },
    },
  },
};
