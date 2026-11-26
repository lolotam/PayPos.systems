import { z } from 'zod';
import { ratingsListPage } from './ratings-list.js';

const errorContent = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};
const uuid = { type: 'string', format: 'uuid' };
const instant = { type: 'string', format: 'date-time' };
const query = (name: string, schema: object) => ({ in: 'query', name, required: false, schema });

export const ratingsListPaths = {
  '/v1/businesses/{businessId}/ratings': {
    get: {
      operationId: 'listRatings',
      security: [{ AdminSession: [] }],
      description:
        'Newest-first keyset page of the ratings of one business. Only a caller whose current role is owner, general manager, business manager or branch manager and who holds read:ratings:branch reads it; rows are limited to the branches inside that scope. from is inclusive and to is exclusive on submitted_at; month (YYYY-MM) instead selects that calendar month in the business time zone, resolved by the server, and cannot be combined with from or to. The comment is the customer text as written. month in the response is the YYYY-MM the server used in the business time zone when the request sent month, and null otherwise. Cache-Control: no-store.',
      parameters: [
        { in: 'path', name: 'businessId', required: true, schema: uuid },
        { in: 'header', name: 'x-company-id', required: true, schema: uuid },
        query('branch_id', uuid),
        query('employee_id', uuid),
        query('from', instant),
        query('to', instant),
        query('month', {
          type: 'string',
          pattern: '^2[0-9]{3}-(0[1-9]|1[0-2])$',
          example: '2026-11',
        }),
        query('cursor', { type: 'string', minLength: 1, maxLength: 512 }),
        query('limit', { type: 'integer', minimum: 1, maximum: 100, default: 20 }),
      ],
      responses: {
        '200': {
          description: 'A page of ratings and the cursor of the next page, or null on the last',
          headers: { 'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } } },
          content: {
            'application/json': {
              schema: z.toJSONSchema(ratingsListPage, {
                target: 'openapi-3.0',
                io: 'input',
                metadata: z.registry(),
              }),
            },
          },
        },
        '400': { description: 'VALIDATION_FAILED or a malformed cursor', content: errorContent },
        '401': { description: 'UNAUTHENTICATED', content: errorContent },
        '403': { description: 'FORBIDDEN', content: errorContent },
        '503': { description: 'NOT_READY', content: errorContent },
      },
    },
  },
};
