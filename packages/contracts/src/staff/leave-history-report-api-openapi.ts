import { z } from 'zod';
import { json } from '../openapi-operation.js';
import { leaveHistoryReportResultQuery } from './leave-history-report-api.js';

const resultQuerySchema = z.toJSONSchema(leaveHistoryReportResultQuery, {
  target: 'openapi-3.0',
  io: 'input',
  metadata: z.registry(),
});
const businessParameters = [
  {
    in: 'path',
    name: 'businessId',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  {
    in: 'header',
    name: 'x-company-id',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
];
const resultQueryParameters = Object.entries(resultQuerySchema.properties ?? {}).map(
  ([name, property]) => ({
    in: 'query',
    name,
    schema: property,
    required: resultQuerySchema.required?.includes(name) ?? false,
  }),
);
const refusal = { description: 'Bilingual refusal', content: json('ErrorEnvelope') };

export const leaveHistoryReportApiPaths = {
  '/v1/businesses/{businessId}/leave-history/reports': {
    post: {
      operationId: 'requestLeaveHistoryReport',
      description:
        'Accepts a creator-scoped asynchronous leave history report, reusing its matching live pending report or refusing a fourth one.',
      parameters: businessParameters,
      requestBody: { required: true, content: json('LeaveHistoryReportRequest') },
      responses: {
        '202': {
          description: 'Leave history report accepted',
          content: json('LeaveHistoryReportAccepted'),
        },
        default: refusal,
      },
    },
  },
  '/v1/businesses/{businessId}/leave-history/reports/{reportId}': {
    get: {
      operationId: 'getLeaveHistoryReportResult',
      description: 'Reads the creator-owned report status or its next bounded result page.',
      parameters: [
        ...businessParameters,
        {
          in: 'path',
          name: 'reportId',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
        ...resultQueryParameters,
      ],
      responses: {
        '200': {
          description: 'Pending, ready or failed leave history report',
          content: json('LeaveHistoryReportStatus'),
        },
        '404': {
          description:
            'LEAVE_HISTORY_REPORT_NOT_FOUND hides unknown, expired, foreign and other creators’ reports; NOT_FOUND hides missing read access.',
          content: json('ErrorEnvelope'),
        },
        '409': {
          description:
            'LEAVE_HISTORY_REPORT_STALE means the frozen branch sets are no longer contained in the caller’s current access.',
          content: json('ErrorEnvelope'),
        },
        default: refusal,
      },
    },
  },
};
