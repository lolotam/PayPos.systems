import { z } from 'zod';
import { attendanceMonthlyReport } from './attendance-monthly-report.js';
import { attendanceStatementPaths } from './attendance-statement-openapi.js';

const parameters = [
  { in: 'header', name: 'x-company-id', required: true, schema: { type: 'string', format: 'uuid' } },
  { in: 'path', name: 'businessId', required: true, schema: { type: 'string', format: 'uuid' } },
  { in: 'query', name: 'month', required: true, schema: { type: 'string', pattern: '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$' } },
];
const branch = { in: 'path', name: 'branchId', required: true, schema: { type: 'string', format: 'uuid' } };
const errors = { description: 'Bilingual refusal', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } };
const description = 'Human read:attendance:branch, staff feature, tenant membership. Minutes are integers; open and voided sessions excluded. Scope refusal is NOT_FOUND.';
const jsonResponse = { '200': { description: 'Monthly attendance rows', content: { 'application/json': {
  schema: z.toJSONSchema(attendanceMonthlyReport, { target: 'openapi-3.0', io: 'input', metadata: z.registry() }),
} } }, default: errors };
const csvResponse = { '200': { description: 'UTF-8 attendance CSV', content: { 'text/csv': { schema: { type: 'string' } } } }, default: errors };
const csvDescription = ' Arabic RFC 4180 CSV with UTF-8 BOM, h:mm and two-decimal hour columns, employee number and names only. One audit per successful export.';
const allDescription = `${description} Every active branch of this business must have a covering grant and no covering DENY.`;
export const attendanceMonthlyReportPaths = {
  // مسارات التقرير والكشف بتشارك تصديراً واحداً عشان ملف التجميع يفضل داخل حد حجمه.
  ...attendanceStatementPaths,
  '/v1/businesses/{businessId}/branches/{branchId}/attendance-report': { get: {
    operationId: 'attendanceMonthlyReport', description, parameters: [...parameters, branch], responses: jsonResponse,
  } },
  '/v1/businesses/{businessId}/branches/{branchId}/attendance-report.csv': { get: {
    operationId: 'attendanceMonthlyReportCsv', description: description + csvDescription,
    parameters: [...parameters, branch], responses: csvResponse,
  } },
  '/v1/businesses/{businessId}/attendance-report': { get: {
    operationId: 'attendanceMonthlyReportAll', description: allDescription, parameters, responses: jsonResponse,
  } },
  '/v1/businesses/{businessId}/attendance-report.csv': { get: {
    operationId: 'attendanceMonthlyReportAllCsv', description: allDescription + csvDescription, parameters, responses: csvResponse,
  } },
};
