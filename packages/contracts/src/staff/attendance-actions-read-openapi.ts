import { z } from 'zod';
import { attendanceExceptionPage, attendanceCorrectionHistory } from './attendance-actions-read.js';

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
const error = {
  description: 'Bilingual refusal',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
};
const response = (schema: typeof attendanceExceptionPage | typeof attendanceCorrectionHistory) => ({
  description: 'Attendance action records',
  content: {
    'application/json': {
      schema: z.toJSONSchema(schema, {
        target: 'openapi-3.0',
        io: 'input',
        metadata: z.registry(),
      }),
    },
  },
});
export const attendanceActionsReadPaths = {
  '/v1/businesses/{businessId}/branches/{branchId}/attendance-exceptions': {
    get: {
      operationId: 'attendanceExceptions',
      description:
        'Requires read:attendance:branch and staff feature. Exceptions of sessions at this branch, newest raised_at/id first, excluding voided sessions. branch_id identifies the exception movement branch for resolve/reopen. Resolution fields are null while OPEN. Cursor preserves microseconds.',
      parameters: [
        ...parameters,
        {
          in: 'query',
          name: 'status',
          schema: { type: 'string', enum: ['OPEN', 'RESOLVED'], default: 'OPEN' },
        },
        {
          in: 'query',
          name: 'cursor',
          schema: { type: 'string', maxLength: 100 },
          description: 'UTC raised_at|id keyset cursor',
        },
        {
          in: 'query',
          name: 'limit',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        },
      ],
      responses: {
        '200': response(attendanceExceptionPage),
        '400': error,
        '403': error,
        '404': error,
        default: error,
      },
    },
  },
  '/v1/businesses/{businessId}/branches/{branchId}/attendance-sessions/{sessionId}/corrections': {
    get: {
      operationId: 'attendanceCorrectionHistory',
      description:
        'Requires read:attendance:branch and staff feature. Oldest corrected_at/id first, including voided sessions. Existing sessions without corrections return an empty items array. Actors use the first non-deleted employee by business_id/id within the company, or null.',
      parameters: [
        ...parameters,
        {
          in: 'path',
          name: 'sessionId',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': response(attendanceCorrectionHistory),
        '400': error,
        '403': error,
        '404': error,
        default: error,
      },
    },
  },
};
