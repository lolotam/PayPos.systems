import { z } from 'zod';

import {
  commissionStatementExportAccepted,
  commissionStatementExportRequest,
  commissionStatementExportStatus,
} from './statement-export-requests.js';

const uuid = { type: 'string', format: 'uuid' };
const base = '/v1/businesses/{businessId}/commission-statements/{period}/exports';
const parameters = [
  { in: 'header', name: 'x-company-id', required: true, schema: uuid },
  { in: 'path', name: 'businessId', required: true, schema: uuid },
  {
    in: 'path',
    name: 'period',
    required: true,
    schema: { type: 'string', pattern: '^(?!0000-)\\d{4}-(0[1-9]|1[0-2])$' },
  },
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
  'Requires an individual session with read:commissions:business and the commissions feature; a device session is refused. The permission is checked inside the route transaction against the effective branch set of the caller (CS-Q20), never from the client. ';
const json = (schema: z.ZodType) => ({
  'application/json': {
    schema: z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input', metadata: z.registry() }),
  },
});

export const commissionStatementExportPaths = {
  [base]: {
    post: {
      operationId: 'requestCommissionStatementExport',
      parameters,
      description:
        description +
        'Exports an APPROVED or PAID month as an Excel workbook (FR-050). The authorized scope and the workbook language are stored before the job is queued; the scope is BUSINESS only for a business-wide reader and otherwise the whole effective branch set with the employees of the frozen statement rows that overlap it. 409 COMMISSION_STATEMENT_NOT_APPROVED when the month is not approved, 429 COMMISSION_STATEMENT_EXPORT_RATE_LIMITED for the user rate limit.',
      requestBody: { required: true, content: json(commissionStatementExportRequest) },
      responses: {
        '202': { description: 'Export queued', content: json(commissionStatementExportAccepted) },
        default: errors,
      },
    },
  },
  [`${base}/{renderId}`]: {
    get: {
      operationId: 'commissionStatementExportStatus',
      parameters: renderParameters,
      description:
        description +
        'Cache-Control: no-store. Every render id outside the requester, business and month answers the same 404.',
      responses: {
        '200': { description: 'Export state', content: json(commissionStatementExportStatus) },
        default: errors,
      },
    },
  },
  [`${base}/{renderId}/download`]: {
    post: {
      operationId: 'downloadCommissionStatementExport',
      parameters: renderParameters,
      description:
        description +
        'Collects once, only by the requester. At collection the caller current authorization must still cover the saved scope and employees (FR-050); otherwise the bytes are discarded and the uniform 403 is returned with no audit entry. Another user, company or an unknown id gets the uniform 404. Writes the audit entry commission_statement.exported. Cache-Control: no-store. 409 DOCUMENT_NOT_READY or 410 DOCUMENT_EXPIRED.',
      responses: {
        '200': {
          description: 'Commission statement workbook',
          content: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
              schema: { type: 'string', format: 'binary' },
            },
          },
        },
        default: errors,
      },
    },
  },
};
