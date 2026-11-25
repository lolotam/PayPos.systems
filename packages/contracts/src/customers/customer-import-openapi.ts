const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});
const errors = { description: 'Bilingual refusal', content: json('ErrorEnvelope') };
const companyHeader = { in: 'header', name: 'x-company-id', required: true, schema: { type: 'string', format: 'uuid' } };
const pathParam = (name: string) => ({ in: 'path', name, required: true, schema: { type: 'string', format: 'uuid' } });
const previewId = pathParam('previewId');
const idempotencyHeader = {
  in: 'header',
  name: 'Idempotency-Key',
  required: true,
  schema: { type: 'string', minLength: 1, maxLength: 255 },
};

function buildPaths(scope: 'business' | 'branch'): Record<string, unknown> {
  const business = scope === 'business';
  const scopeName = business ? 'businessId' : 'branchId';
  const base = `/v1/${business ? 'businesses' : 'branches'}/{${scopeName}}/customers/import`;
  const suffix = business ? '' : 'Branch';
  const parameters = [companyHeader, pathParam(scopeName)];
  return {
    [`${base}/template`]: {
      get: {
        operationId: `get${suffix}CustomerImportTemplate`,
        description: 'Downloads the customer import XLSX template (ten headers with Arabic notes and reference sheet).',
        parameters,
        responses: { '200': { description: 'Import template workbook', content: json('CustomerImportTemplate') }, '404': errors, '422': errors, default: errors },
      },
    },
    [`${base}/previews`]: {
      post: {
        operationId: `preview${suffix}CustomerImport`,
        description: 'Previews a READY XLSX upload outside any DB transaction, requiring business country and returning masked phones and row errors.',
        parameters,
        requestBody: { required: true, content: json('PreviewCustomerImportInput') },
        responses: {
          '201': { description: 'Saved preview with errors and first clean rows', content: json('CustomerImportPreview') },
          '404': errors,
          '409': errors,
          '413': errors,
          '415': errors,
          '422': errors,
          default: errors,
        },
      },
    },
    [`${base}/previews/{previewId}/rows`]: {
      get: {
        operationId: `get${suffix}CustomerImportRows`,
        description: 'Cursor-paginated clean rows of one preview for its creator, carrying masked phones only.',
        parameters: [
          ...parameters,
          previewId,
          { in: 'query', name: 'cursor', schema: { $ref: '#/components/schemas/CustomerImportRowsCursor' } },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: { '200': { description: 'Clean rows page', content: json('CustomerImportRowsPage') }, '404': errors, default: errors },
      },
    },
    [`${base}/previews/{previewId}`]: {
      get: {
        operationId: `get${suffix}CustomerImportStatus`,
        description: 'Reads preview status (ready, commit_requested, committed, failed) for its creator only.',
        parameters: [...parameters, previewId],
        responses: { '200': { description: 'Preview status', content: json('CustomerImportStatus') }, '404': errors, default: errors },
      },
    },
    [`${base}/commits`]: {
      post: {
        operationId: `commit${suffix}CustomerImport`,
        description: 'Accepts one clean unexpired preview commit idempotently and appends CustomerImportCommitRequested in the same transaction.',
        parameters: [...parameters, idempotencyHeader],
        requestBody: { required: true, content: json('CommitCustomerImportInput') },
        responses: {
          '202': { description: 'Commit accepted', content: json('CustomerImportCommitAccepted') },
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
}

/** مسارات استيراد العملاء: النشاط والفرع، بنفس المعنى (073 CI-T3، CI-T5). */
export const customerImportPaths = { ...buildPaths('business'), ...buildPaths('branch') };
