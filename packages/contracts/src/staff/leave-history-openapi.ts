import { z } from 'zod';
import { leaveHistoryQuery } from './leave-history.js';

const schema = z.toJSONSchema(leaveHistoryQuery, {
  target: 'openapi-3.0',
  io: 'input',
  metadata: z.registry(),
});
export const leaveHistoryPaths = {
  '/v1/businesses/{businessId}/employees/{employeeId}/leave-history': {
    get: {
      operationId: 'getEmployeeLeaveHistory',
      parameters: [
        ...['businessId', 'employeeId'].map((name) => ({
          in: 'path',
          name,
          required: true,
          schema: { type: 'string', format: 'uuid' },
        })),
        {
          in: 'header',
          name: 'x-company-id',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
        ...Object.entries(schema.properties ?? {}).map(([name, property]) => ({
          in: 'query',
          name,
          schema: property,
          required: schema.required?.includes(name) ?? false,
          ...(name.endsWith('[]') ? { style: 'form', explode: true } : {}),
        })),
      ],
      responses: {
        '200': {
          description: 'Leave history',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LeaveHistoryPage' },
            },
          },
        },
        default: {
          description: 'Bilingual refusal',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorEnvelope' },
            },
          },
        },
      },
    },
  },
};
