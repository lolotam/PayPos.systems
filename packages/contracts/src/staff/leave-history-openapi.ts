import { z } from 'zod';
import { leaveHistoryQuery, leaveHistoryReportQuery } from './leave-history.js';

const schema = z.toJSONSchema(leaveHistoryQuery, {
  target: 'openapi-3.0',
  io: 'input',
  metadata: z.registry(),
});
const reportSchema = z.toJSONSchema(leaveHistoryReportQuery, {
  target: 'openapi-3.0',
  io: 'input',
  metadata: z.registry(),
});

function leaveHistoryGet(operationId: string, pathIds: string[], querySchema: typeof schema) {
  return {
    operationId,
    parameters: [
      ...pathIds.map((name) => ({
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
      ...Object.entries(querySchema.properties ?? {}).map(([name, property]) => ({
        in: 'query',
        name,
        schema: property,
        required: querySchema.required?.includes(name) ?? false,
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
  };
}

export const leaveHistoryPaths = {
  '/v1/businesses/{businessId}/employees/{employeeId}/leave-history': {
    get: leaveHistoryGet('getEmployeeLeaveHistory', ['businessId', 'employeeId'], schema),
  },
  '/v1/businesses/{businessId}/leave-history': {
    get: leaveHistoryGet('getLeaveHistoryReport', ['businessId'], reportSchema),
  },
};
