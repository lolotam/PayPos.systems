import { z } from 'zod';

import {
  attendanceStatementAccepted,
  attendanceStatementRequest,
  attendanceStatementStatus,
} from './attendance-statement.js';
import { attendanceStatementShiftOptions } from './attendance-statement-shifts.js';

const uuid = { type: 'string', format: 'uuid' };
const parameters = [
  { in: 'header', name: 'x-company-id', required: true, schema: uuid },
  { in: 'path', name: 'businessId', required: true, schema: uuid },
  { in: 'path', name: 'branchId', required: true, schema: uuid },
];
const renderParameters = [
  ...parameters,
  { in: 'path', name: 'renderId', required: true, schema: uuid },
];
const errors = {
  description: 'Bilingual refusal',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
};
const description =
  'Human read:attendance:branch permission, staff feature and tenant membership required. ';
const base = '/v1/businesses/{businessId}/branches/{branchId}';
const json = (schema: z.ZodType) => ({
  'application/json': {
    schema: z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input', metadata: z.registry() }),
  },
});

export const attendanceStatementPaths = {
  [`${base}/attendance-statements`]: {
    post: {
      operationId: 'requestAttendanceStatement',
      parameters,
      description:
        description +
        'Returns 403 for permission refusal, 404 for branch or employee, 422 for period or shift filter, 429 for the user rate limit, and 503 when the renderer is unavailable.',
      requestBody: { required: true, content: json(attendanceStatementRequest) },
      responses: {
        '202': { description: 'Statement queued', content: json(attendanceStatementAccepted) },
        default: errors,
      },
    },
  },
  [`${base}/attendance-statements/{renderId}`]: {
    get: {
      operationId: 'attendanceStatementStatus',
      parameters: renderParameters,
      description:
        description +
        'Cache-Control: no-store. Every render id outside the requester and route scope returns the same 404.',
      responses: {
        '200': { description: 'Statement state', content: json(attendanceStatementStatus) },
        default: errors,
      },
    },
  },
  [`${base}/attendance-statements/{renderId}/download`]: {
    post: {
      operationId: 'downloadAttendanceStatement',
      parameters: renderParameters,
      description:
        description +
        'Collects once with one audit entry. Cache-Control: no-store. Returns 409 DOCUMENT_NOT_READY or 410 DOCUMENT_EXPIRED.',
      responses: {
        '200': {
          description: 'Attendance statement PDF',
          content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
        },
        default: errors,
      },
    },
  },
  [`${base}/attendance-statement-shifts`]: {
    get: {
      operationId: 'attendanceStatementShifts',
      description,
      parameters: [
        ...parameters,
        ...['from', 'to'].map((name) => ({
          in: 'query',
          name,
          required: true,
          schema: { type: 'string', format: 'date' },
        })),
      ],
      responses: {
        '200': {
          description: 'Distinct branch-local shift pairs',
          content: json(attendanceStatementShiftOptions),
        },
        default: errors,
      },
    },
  },
};
