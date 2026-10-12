import { z } from 'zod';
import { attendanceCapabilities } from './attendance-capabilities.js';

const errors = {
  description: 'Bilingual refusal',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
};
export const attendanceCapabilitiesPaths = {
  '/v1/businesses/{businessId}/branches/{branchId}/attendance-capabilities': {
    get: {
      operationId: 'attendanceCapabilities',
      description:
        'Requires read:attendance:branch and staff feature. Live write grants from the shared request authorizer; row self restrictions still apply.',
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
          name: 'branchId',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': {
          description: 'Attendance write capabilities',
          content: {
            'application/json': {
              schema: z.toJSONSchema(attendanceCapabilities, {
                target: 'openapi-3.0',
                io: 'input',
                metadata: z.registry(),
              }),
            },
          },
        },
        '400': errors,
        '403': errors,
        '404': errors,
        default: errors,
      },
    },
  },
};
