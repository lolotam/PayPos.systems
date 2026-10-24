import { z } from 'zod';
import { employeeAppLink } from './employee-app-link.js';

const errors = {
  description: 'Bilingual refusal',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
};
export const employeeAppLinkPaths = {
  '/v1/businesses/{businessId}/staff/employee-app-link': {
    get: {
      operationId: 'employeeAppLink',
      description:
        "Requires manage:employees:business on the business and the staff feature. Every refusal is the guard's 403.",
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
      ],
      responses: {
        '200': {
          description: 'Employee app link names and ids',
          content: {
            'application/json': {
              schema: z.toJSONSchema(employeeAppLink, {
                target: 'openapi-3.0',
                io: 'input',
                metadata: z.registry(),
              }),
            },
          },
        },
        '400': errors,
        '401': errors,
        '403': errors,
        default: errors,
      },
    },
  },
};
