import { z } from 'zod';
import { ratingAverages } from './ratings-averages.js';

const errorContent = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};
const uuid = { type: 'string', format: 'uuid' };
const instant = { type: 'string', format: 'date-time' };
const query = (name: string, schema: object) => ({ in: 'query', name, required: false, schema });

export const ratingAveragesPaths = {
  '/v1/businesses/{businessId}/ratings/averages': {
    get: {
      operationId: 'listRatingAverages',
      security: [{ AdminSession: [] }],
      description:
        'Per-employee average stars of one business over a range, for the same callers and branch scope as the ratings list. average is a one-decimal string rounded half up; a rating with two performers counts for both. from is inclusive and to is exclusive on submitted_at; month (YYYY-MM) instead selects that calendar month in the business time zone and cannot be combined with from or to; with none of the three, the range is the current calendar month in the business time zone. An explicit range needs both from and to and spans at most 366 days; a wider range or a one-sided range is refused with 422 RATING_RANGE_TOO_WIDE. month in the response is the YYYY-MM the server used in the business time zone (the requested or the current month), and null when from or to was sent. Cache-Control: no-store.',
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
      ],
      responses: {
        '200': {
          description: 'One entry per employee with at least one rating in the range',
          headers: { 'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } } },
          content: {
            'application/json': {
              schema: z.toJSONSchema(ratingAverages, {
                target: 'openapi-3.0',
                io: 'input',
                metadata: z.registry(),
              }),
            },
          },
        },
        '400': { description: 'VALIDATION_FAILED', content: errorContent },
        '401': { description: 'UNAUTHENTICATED', content: errorContent },
        '403': { description: 'FORBIDDEN', content: errorContent },
        '422': { description: 'RATING_RANGE_TOO_WIDE', content: errorContent },
        '503': { description: 'NOT_READY', content: errorContent },
      },
    },
  },
};
