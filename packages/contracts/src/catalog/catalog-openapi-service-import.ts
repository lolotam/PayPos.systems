import { errors, json, parameters, serviceId } from './catalog-openapi-common.js';

// معرّف المعاينة مسار مستقل عن معرّف الخدمة: القالب والمعاينة والصفوف والحالة والقبول.
const previewId = { ...serviceId, name: 'previewId' };

// مسارات استيراد الخدمات: القالب، والمعاينة، والصفوف، والحالة، والقبول (FR-001 إلى FR-011).
export const serviceImportPaths = {
  '/v1/businesses/{businessId}/services/import/template': {
    get: {
      operationId: 'getServiceImportTemplate',
      description:
        'Downloads one XLSX import template for the business: the eight authoritative headers with Arabic cell notes, and a reference sheet explaining the four commission rules, the accepted boolean spellings, and every open category of the business with its English and Arabic names; import matches the English names. A business whose complete reference exceeds the guarded reader limits is refused with IMPORT_TEMPLATE_EXCEEDS_LIMITS (422) instead of a truncated or unimportable template. Requires manage:services:business and the catalog feature. Never writes.',
      parameters,
      responses: {
        '200': { description: 'Import template workbook', content: json('ServiceImportTemplate') },
        '404': errors,
        '422': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/services/import/previews': {
    post: {
      operationId: 'previewServiceImport',
      description:
        'Previews one verified private upload against the business: file ownership, READY status and XLSX type are checked before the bytes are read once outside any database transaction, and the 2 MiB and 500-row limits are enforced by the guarded reader on those bytes; category labels are matched in one PostgreSQL batch against open categories of the business and English names are compared against all stored services with the same PostgreSQL fold on both sides. Returns every error with its original sheet row and column, and only error-free normalized rows. The preview, its errors and its rows are saved in one tenant transaction; no service and no service audit is written, and the private-file access itself is recorded once in its own audit entry. Requires manage:services:business and the catalog feature.',
      parameters,
      requestBody: { required: true, content: json('PreviewServiceImportInput') },
      responses: {
        '201': { description: 'Saved preview with errors and first clean rows', content: json('ServiceImportPreview') },
        '404': errors,
        '409': errors,
        '413': errors,
        '415': errors,
        '422': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/services/import/previews/{previewId}/rows': {
    get: {
      operationId: 'getServiceImportRows',
      description:
        'Cursor-paginated clean normalized rows of one preview, to its creator only within the business; the cursor is the original Excel row number as a decimal string, so sparse sheets keep their numbering. Unknown, foreign or other-entity previews share IMPORT_PREVIEW_NOT_FOUND (404). Requires manage:services:business and the catalog feature.',
      parameters: [
        ...parameters,
        previewId,
        {
          in: 'query',
          name: 'cursor',
          schema: { $ref: '#/components/schemas/ServiceImportRowsCursor' },
          description: 'Original Excel row number of the last returned row; omit for the first page.',
        },
        {
          in: 'query',
          name: 'limit',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      ],
      responses: {
        '200': { description: 'Clean rows page', content: json('ServiceImportRowsPage') },
        '404': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/services/import/previews/{previewId}': {
    get: {
      operationId: 'getServiceImportStatus',
      description:
        'One preview status without row data: preview_id, status, created_count and error_code, to its creator only. Unknown, foreign or other-entity previews share IMPORT_PREVIEW_NOT_FOUND (404). Requires manage:services:business and the catalog feature.',
      parameters: [...parameters, previewId],
      responses: {
        '200': { description: 'Preview status', content: json('ServiceImportStatus') },
        '404': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/services/import/commits': {
    post: {
      operationId: 'commitServiceImport',
      description:
        'Requests a worker commit for a creator-owned clean, unexpired preview of the business. The preview is locked FOR UPDATE, moves to commit_requested with one injected instant, and the id-only ServiceImportCommitRequested event is appended in the same tenant transaction, so a lost event and a lost request cannot diverge. Repeats return the same preview id and add no event. Requires Idempotency-Key; poll the preview status for the atomic result. Requires manage:services:business and the catalog feature.',
      parameters: [
        ...parameters,
        {
          in: 'header',
          name: 'Idempotency-Key',
          required: true,
          schema: { type: 'string', minLength: 1, maxLength: 255 },
        },
      ],
      requestBody: { required: true, content: json('CommitServiceImportInput') },
      responses: {
        '202': { description: 'Commit accepted', content: json('ServiceImportCommitAccepted') },
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
