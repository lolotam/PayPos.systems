import { z } from 'zod';
import { employeeNumberEditCapability } from './employee-number.js';

const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});
const bodyJson = (schema: z.ZodType) => ({
  'application/json': {
    schema: z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input', metadata: z.registry() }),
  },
});
const errors = { description: 'Bilingual refusal', content: json('ErrorEnvelope') };

export const employeeNumberEditCapabilityPaths = {
  '/v1/businesses/{businessId}/employees/{employeeId}/employee-number-capability': {
    get: {
      operationId: 'employeeNumberEditCapability',
      description:
        'Lock-free FR-006 read of one employee. can_edit_number is true only when readEmployeeNumberAccess would return null for that employee business and every current attachment: the primary branch, even after its attachment has ended, plus each attachment that is still current, including one whose end date is in the future. Missing manage:employee-number:company, any DENY, and an unknown, foreign, soft-deleted, or wrong-business employee all return the same 200 body with can_edit_number false. FEATURE_DISABLED stays its own bilingual error. No Idempotency-Key.',
      parameters: [
        {
          in: 'header',
          name: 'x-company-id',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
        {
          in: 'path',
          name: 'businessId',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
        {
          in: 'path',
          name: 'employeeId',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': {
          description: 'Whether this caller may edit that employee number',
          content: bodyJson(employeeNumberEditCapability),
        },
        '400': errors,
        '403': errors,
        '404': errors,
        default: errors,
      },
    },
  },
};
