const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});
const uuid = { type: 'string', format: 'uuid' };
const company = { in: 'header', name: 'x-company-id', required: true, schema: uuid };
const idempotency = {
  in: 'header',
  name: 'Idempotency-Key',
  required: true,
  schema: { type: 'string', minLength: 1, maxLength: 255 },
};
const typeId = { in: 'path', name: 'typeId', required: true, schema: uuid };
const employeePath = [
  company,
  { in: 'path', name: 'businessId', required: true, schema: uuid },
  { in: 'path', name: 'employeeId', required: true, schema: uuid },
];
const responses = (status: '200' | '201', schema: string) => ({
  [status]: { description: schema, content: json(schema) },
  default: {
    description: 'Bilingual refusal; unknown and inaccessible share NOT_FOUND',
    content: json('ErrorEnvelope'),
  },
});
const typeCommand = (operationId: string, description: string) => ({
  post: {
    operationId,
    description,
    parameters: [company, idempotency, typeId],
    requestBody: { required: true, content: json('DocumentTypeRevisionInput') },
    responses: responses('200', 'DocumentType'),
  },
});

export const employeeDocumentPaths = {
  '/v1/document-types': {
    get: {
      operationId: 'listDocumentTypes',
      description:
        'Every company document type, active first. Requires manage:document-types:company.',
      parameters: [company],
      responses: responses('200', 'DocumentTypeList'),
    },
    post: {
      operationId: 'createDocumentType',
      description: 'Adds a company document type with a generated immutable code; audited.',
      parameters: [company, idempotency],
      requestBody: { required: true, content: json('CreateDocumentTypeInput') },
      responses: responses('201', 'DocumentType'),
    },
  },
  '/v1/document-types/{typeId}': {
    patch: {
      operationId: 'updateDocumentType',
      description: 'Edits names, alert days and the expiry rule at the expected revision; audited.',
      parameters: [company, idempotency, typeId],
      requestBody: { required: true, content: json('UpdateDocumentTypeInput') },
      responses: responses('200', 'DocumentType'),
    },
  },
  '/v1/document-types/{typeId}/deactivate': typeCommand(
    'deactivateDocumentType',
    'Hides the type from new documents; existing documents keep it. Never deletes.',
  ),
  '/v1/document-types/{typeId}/reactivate': typeCommand(
    'reactivateDocumentType',
    'Makes an inactive type selectable again.',
  ),
  '/v1/businesses/{businessId}/employees/{employeeId}/documents': {
    get: {
      operationId: 'listEmployeeDocuments',
      description:
        'Current document per type with its expiry status and document number in the business timezone. Requires read:files:business and the staff feature.',
      parameters: employeePath,
      responses: responses('200', 'EmployeeDocumentsView'),
    },
    post: {
      operationId: 'recordEmployeeDocument',
      description:
        'Binds a READY file the caller uploaded for this employee; replaces the current document of the type. Row, audit and EmployeeDocumentRecorded commit together. The optional document_number is stored only; the response carries none.',
      parameters: [...employeePath, idempotency],
      requestBody: { required: true, content: json('RecordEmployeeDocumentInput') },
      responses: responses('200', 'EmployeeDocument'),
    },
  },
  '/v1/businesses/{businessId}/employee-document-numbers': {
    get: {
      operationId: 'employeeDocumentNumbers',
      description:
        'Current document numbers by id, one CSV of 1 to 20 distinct UUIDs (case-insensitive; repeated query parameters refused). Requires read:files:business on the business and the staff feature, checked before any document row is read; without it every ids value answers the same 404. Absent from the answer: foreign ids, replaced documents, deleted employees, documents without a number. Cache-Control: no-store.',
      parameters: [
        company,
        { in: 'path', name: 'businessId', required: true, schema: uuid },
        {
          in: 'query',
          name: 'ids',
          required: true,
          schema: { type: 'string', description: 'Comma-separated UUIDs' },
        },
      ],
      responses: {
        200: {
          description: 'EmployeeDocumentNumbers',
          headers: { 'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } } },
          content: json('EmployeeDocumentNumbers'),
        },
        default: {
          description: 'Bilingual refusal; no permission and unknown ids share the same refusal',
          content: json('ErrorEnvelope'),
        },
      },
    },
  },
};
