import { json } from '../openapi-operation.js';

const parameters = [
  {
    in: 'header',
    name: 'x-company-id',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  { in: 'path', name: 'businessId', required: true, schema: { type: 'string', format: 'uuid' } },
];
const refusal = { description: 'Bilingual refusal', content: json('ErrorEnvelope') };
export const packageImportPreviewPaths = {
  '/v1/businesses/{businessId}/packages/import/template': {
    get: {
      operationId: 'getPackageImportTemplate',
      description:
        'Downloads one XLSX import template for the business: the packages sheet with the 66 authoritative headers and Arabic cell notes, and a services sheet listing every open service of the business with its English and Arabic names (closed services are excluded, so they cannot be imported). A business whose complete services sheet exceeds the guarded reader limits is refused with IMPORT_TEMPLATE_EXCEEDS_LIMITS (422) instead of a truncated or unimportable template. Requires import:packages:business and orders. Never writes.',
      parameters,
      responses: {
        '200': { description: 'Import template workbook', content: json('PackageImportTemplate') },
        '403': refusal,
        '404': refusal,
        '422': refusal,
        default: refusal,
      },
    },
  },
  '/v1/businesses/{businessId}/packages/import/commits': {
    post: {
      operationId: 'commitPackageImport',
      description:
        'Requests a worker commit for a creator-owned, error-free, unexpired READY preview of the business. The preview is locked FOR UPDATE, moves to commit_requested with one injected instant and the accepting membership, and the id-only PackageImportCommitRequested event is appended in the same tenant transaction. Repeats on a commit_requested or committed preview return the same preview id and add no event. Requires Idempotency-Key, import:packages:business and orders; poll the preview status for the atomic result.',
      parameters: [
        ...parameters,
        {
          in: 'header',
          name: 'Idempotency-Key',
          required: true,
          schema: { type: 'string', minLength: 1, maxLength: 255 },
        },
      ],
      requestBody: { required: true, content: json('CommitPackageImportInput') },
      responses: {
        '202': { description: 'Commit accepted', content: json('PackageImportCommitAccepted') },
        '400': refusal,
        '403': refusal,
        '404': refusal,
        '409': refusal,
        '422': refusal,
        default: refusal,
      },
    },
  },
  '/v1/businesses/{businessId}/packages/import/previews': {
    post: {
      operationId: 'requestPackageImportPreview',
      description:
        'Requires import:packages:business and orders. Accepts an owned READY workbook for asynchronous preview. Poll the returned preview ID for ready or failed results.',
      parameters,
      requestBody: { required: true, content: json('RequestPackageImportPreviewInput') },
      responses: {
        '202': {
          description: 'Preview request accepted',
          content: json('PackageImportPreviewAccepted'),
        },
        '404': refusal,
        default: refusal,
      },
    },
  },
  '/v1/businesses/{businessId}/packages/import/previews/{previewId}': {
    get: {
      operationId: 'packageImportPreviewStatus',
      description:
        'Creator/company/business-scoped polling, with no full phone or stored candidate rows in the response. Unknown and inaccessible IDs share IMPORT_PREVIEW_NOT_FOUND.',
      parameters: [
        ...parameters,
        {
          in: 'path',
          name: 'previewId',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': {
          description: 'Pending, ready, commit_requested, committed or failed preview',
          content: json('PackageImportPreviewStatus'),
        },
        '404': refusal,
        default: refusal,
      },
    },
  },
};
