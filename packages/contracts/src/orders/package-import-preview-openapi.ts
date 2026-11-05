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
        '47-1a contract: the production route is unregistered until the 47-1b consumer is available and therefore returns 404. Once activated, requires import:packages:business and orders; checks file facts only, atomically stores a pending preview and its id-only outbox event, and returns 202. No object download or workbook parsing occurs at acceptance.',
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
        'Creator/company/business-scoped polling, with no full phone or stored candidate rows in the response. Unknown and inaccessible IDs share IMPORT_PREVIEW_NOT_FOUND. The production route is unregistered in 47-1a and activates with 47-1b.',
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
