import { z } from 'zod';
import {
  employeeNumberCapability,
  employeeNumberView,
  setEmployeeNumberInput,
} from './employee-number.js';

const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});
const bodyJson = (
  schema: typeof employeeNumberView | typeof setEmployeeNumberInput | typeof employeeNumberCapability,
) => ({
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
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/employee-number-capability': {
    get: {
      operationId: 'employeeNumberCapability',
      description:
        'Authorized exactly like create-employee: manage:employees:business on the business and primary_branch_id, plus the staff feature, read without taking the creation locks. A primary branch outside that business is EMPLOYEE_BRANCH_NOT_FOUND (404) before permission. can_type_number is true only when the caller holds manage:employee-number:company with no DENY on that business or primary branch. Missing the number permission or any DENY returns false, not 403. No Idempotency-Key.',
      parameters: [
        { in: 'header', name: 'x-company-id', required: true, schema: { type: 'string', format: 'uuid' } },
        {
          in: 'path',
          name: 'businessId',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
        {
          in: 'query',
          name: 'primary_branch_id',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': { description: 'Whether this caller may type a number for that primary branch', content: bodyJson(employeeNumberCapability) },
        '400': errors,
        '403': errors,
        '404': errors,
        default: errors,
      },
    },
  },
};
