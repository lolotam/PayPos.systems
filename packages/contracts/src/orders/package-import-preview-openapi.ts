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
          description: 'Pending, ready or failed preview',
          content: json('PackageImportPreviewStatus'),
        },
        '404': refusal,
        default: refusal,
      },
    },
  },
};
