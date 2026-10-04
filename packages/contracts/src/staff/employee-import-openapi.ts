const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});
const errors = { description: 'Bilingual refusal', content: json('ErrorEnvelope') };
const parameters = [
  {
    in: 'header',
    name: 'x-company-id',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  { in: 'path', name: 'businessId', required: true, schema: { type: 'string', format: 'uuid' } },
];

export const employeeImportPaths = {
  '/v1/businesses/{businessId}/employees/import/template': {
    get: {
      operationId: 'employeeImportTemplate',
      description:
        'Bilingual employee import template for one business. Requires manage:employees:business and the staff feature; unknown and inaccessible businesses share the same refusal.',
      parameters,
      responses: {
        '200': { description: 'Template workbook', content: json('EmployeeImportTemplate') },
        '403': errors,
        '404': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/employees/import/previews': {
    post: {
      operationId: 'previewEmployeeImport',
      description:
        'Parses a READY uploaded workbook (first sheet, English headers), validates every row with the create-employee rules and writes no employee. Unknown, cross-tenant or cross-business files all answer IMPORT_FILE_NOT_FOUND (404).',
      parameters,
      requestBody: { required: true, content: json('PreviewEmployeeImportInput') },
      responses: {
        '201': { description: 'Preview with per-row errors', content: json('EmployeeImportPreview') },
        '400': errors,
        '403': errors,
        '404': errors,
        '409': errors,
        '413': errors,
        '415': errors,
        '422': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/employees/import/commits': {
    post: {
      operationId: 'commitEmployeeImport',
      description:
        'Commits a zero-error, unexpired, unused preview: all employees, attachments, audits and events in one transaction; re-validates branches under lock. Requires Idempotency-Key.',
      parameters: [
        ...parameters,
        {
          in: 'header',
          name: 'Idempotency-Key',
          required: true,
          schema: { type: 'string', minLength: 1, maxLength: 255 },
        },
      ],
      requestBody: { required: true, content: json('CommitEmployeeImportInput') },
      responses: {
        '201': { description: 'Commit summary', content: json('EmployeeImportCommit') },
        '400': errors,
        '403': errors,
        '404': errors,
        '409': errors,
        '422': errors,
        default: errors,
      },
    },
  },
};
