import { z } from 'zod';
import { personalBranches } from './personal-branches.js';
const errorContent = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};
export const personalBranchesPaths = {
  '/v1/staff/me/branches': {
    get: {
      operationId: 'personalBranches',
      description:
        'Personal session only. Current active employee attachments and covering live membership are rechecked in the read transaction. No leave permission or private-view window. No client subject selectors. Cache-Control: no-store.',
      security: [{ PersonalStaffSession: [] }],
      responses: {
        '200': {
          description: 'Current attached active branches with effective timezone',
          headers: { 'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } } },
          content: {
            'application/json': {
              schema: z.toJSONSchema(personalBranches, { target: 'openapi-3.0', io: 'input' }),
            },
          },
        },
        '401': { description: 'UNAUTHENTICATED', content: errorContent },
        '403': { description: 'FORBIDDEN', content: errorContent },
      },
    },
  },
};
