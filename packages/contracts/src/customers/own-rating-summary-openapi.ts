import { z } from 'zod';
import { ownRatingSummary } from './own-rating-summary.js';

const errorContent = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};
export const ownRatingSummaryPaths = {
  '/v1/staff/me/rating-summary': {
    get: {
      operationId: 'ownRatingSummary',
      description:
        'Own rating summary for the current business-timezone month. The employee comes from the personal session; any subject key in the query is a 403. Live authority (membership, customers feature, read:ratings:own) is checked before the rating_average column gate; HIDDEN contains only visibility and reads no rating row. The personal staff session only. Cache-Control: no-store.',
      security: [{ PersonalStaffSession: [] }],
      responses: {
        '200': {
          description: 'HIDDEN, or the own VISIBLE average and count; count = 0 iff average = null',
          headers: { 'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } } },
          content: {
            'application/json': {
              schema: z.toJSONSchema(ownRatingSummary, {
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
        '503': { description: 'NOT_READY', content: errorContent },
      },
    },
  },
};
