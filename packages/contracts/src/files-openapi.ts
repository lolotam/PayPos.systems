import {
  requestFileUpload,
  fileUploadTicket,
  fileStatus,
  fileConfirmation,
  fileDownload,
  fileDownloadByKey,
} from './files.js';

export const fileSchemas = [
  requestFileUpload,
  fileUploadTicket,
  fileStatus,
  fileConfirmation,
  fileDownload,
  fileDownloadByKey,
];

const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});
function operation(
  operationId: string,
  response: string,
  status: string,
  parameter: string | undefined,
  input?: string,
) {
  return {
    operationId,
    parameters: [
      {
        in: 'header',
        name: 'x-company-id',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      },
      ...(parameter === undefined
        ? []
        : [
            {
              in: 'path',
              name: parameter,
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ]),
    ],
    ...(input === undefined ? {} : { requestBody: { required: true, content: json(input) } }),
    responses: {
      [status]: { description: response, content: json(response) },
      default: { description: 'Bilingual error', content: json('ErrorEnvelope') },
    },
  };
}
export const filePaths = {
  '/v1/files/download': {
    post: operation(
      'issueFileDownloadByKey',
      'FileDownload',
      '200',
      undefined,
      'FileDownloadByKey',
    ),
  },
  '/v1/businesses/{businessId}/files/uploads': {
    post: operation(
      'requestFileUpload',
      'FileUploadTicket',
      '201',
      'businessId',
      'RequestFileUpload',
    ),
  },
  '/v1/files/{id}/confirm': {
    post: operation('confirmFileUpload', 'FileConfirmation', '202', 'id'),
  },
  '/v1/files/{id}': { get: operation('getFileStatus', 'FileStatus', '200', 'id') },
  '/v1/files/{id}/download': { post: operation('issueFileDownload', 'FileDownload', '200', 'id') },
};
