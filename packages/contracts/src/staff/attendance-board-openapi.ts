import { z } from 'zod';
import { attendanceBoard } from './attendance-board.js';
import { attendanceDeviceRefusalPage } from './attendance-device-refusals.js';

const json = (schema: typeof attendanceBoard | typeof attendanceDeviceRefusalPage) => ({
  'application/json': {
    schema: z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input', metadata: z.registry() }),
  },
});
const parameters = [
  {
    in: 'header',
    name: 'x-company-id',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  { in: 'path', name: 'businessId', required: true, schema: { type: 'string', format: 'uuid' } },
  { in: 'path', name: 'branchId', required: true, schema: { type: 'string', format: 'uuid' } },
];
const errors = {
  description: 'Bilingual refusal',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
};
export const attendanceBoardPaths = {
  '/v1/businesses/{businessId}/branches/{branchId}/attendance-board': {
    get: {
      operationId: 'attendanceBoard',
      description:
        'Requires read:attendance:branch and staff feature. Open sessions from any working date; non-voided sessions for the requested working date. Future dates return empty lists. No private employee fields or hours.',
      parameters: [
        ...parameters,
        { in: 'query', name: 'date', schema: { type: 'string', format: 'date' } },
      ],
      responses: {
        '200': { description: 'Attendance board', content: json(attendanceBoard) },
        '400': errors,
        '403': errors,
        '404': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/branches/{branchId}/attendance-board/refusals': {
    get: {
      operationId: 'attendanceBoardRefusals',
      description:
        'Requires read:attendance:branch and staff feature. Newest first keyset page of branch refusals, without installation hashes.',
      parameters: [
        ...parameters,
        { in: 'query', name: 'cursor', schema: { type: 'string', maxLength: 100 } },
        {
          in: 'query',
          name: 'limit',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        },
      ],
      responses: {
        '200': {
          description: 'Refused attendance attempts',
          content: json(attendanceDeviceRefusalPage),
        },
        '400': errors,
        '403': errors,
        '404': errors,
        default: errors,
      },
    },
  },
};
