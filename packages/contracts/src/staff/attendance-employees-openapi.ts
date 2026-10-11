import { z } from 'zod';
import { attendanceEmployeePage } from './attendance-employees.js';

const error = {
  description: 'Bilingual refusal',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
};
export const attendanceEmployeesPaths = {
  '/v1/businesses/{businessId}/branches/{branchId}/attendance-employees': {
    get: {
      operationId: 'attendanceEmployees',
      description:
        'Manual-day employee picker. Requires request:attendance-change:branch and staff feature; inaccessible branches return NOT_FOUND. Only id, name_ar and name_en. Non-deleted employees with currentAttachment links, including future-start links and links ending after branch-local today. Ordered by name_en/id. Case-insensitive literal substring search is bounded to the indexed company/business/branch link set, materialized before matching names; no global name scan.',
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
        { in: 'query', name: 'search', schema: { type: 'string', maxLength: 100 } },
        {
          in: 'query',
          name: 'cursor',
          schema: { type: 'string', maxLength: 2048 },
          description: 'URL-encoded JSON [name_en,id] keyset cursor from next_cursor',
        },
        {
          in: 'query',
          name: 'limit',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        },
      ],
      responses: {
        '200': {
          description: 'Attendance employee page',
          content: {
            'application/json': {
              schema: z.toJSONSchema(attendanceEmployeePage, {
                target: 'openapi-3.0',
                io: 'input',
                metadata: z.registry(),
              }),
            },
          },
        },
        '400': error,
        '403': error,
        '404': error,
        default: error,
      },
    },
  },
};
