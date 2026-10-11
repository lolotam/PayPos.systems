const json = (name: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${name}` } },
});
const path = (name: string) => ({
  in: 'path',
  name,
  required: true,
  schema: { type: 'string', format: 'uuid' },
});
const company = {
  in: 'header',
  name: 'x-company-id',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
const idem = {
  in: 'header',
  name: 'Idempotency-Key',
  required: true,
  schema: { type: 'string', minLength: 1, maxLength: 255 },
};
const response = (name: string, status = '200') => ({
  [status]: { description: name, content: json(name) },
  default: { description: 'Bilingual refusal', content: json('ErrorEnvelope') },
});
const write = (
  operationId: string,
  input: string,
  result: string,
  status: string,
  requestId = false,
) => ({
  operationId,
  parameters: [company, path('businessId'), ...(requestId ? [path('requestId')] : []), idem],
  requestBody: { required: true, content: json(input) },
  responses: response(result, status),
});
export const attendanceChangePaths = {
  '/v1/businesses/{businessId}/attendance-change-requests': {
    post: write(
      'requestAttendanceChange',
      'AttendanceChangeRequestInput',
      'AttendanceChangeRequest',
      '201',
    ),
    get: {
      operationId: 'listAttendanceChangeRequests',
      parameters: [
        company,
        path('businessId'),
        ...['branch_id', 'employee_id'].map((name) => ({
          in: 'query',
          name,
          schema: { type: 'string', format: 'uuid' },
        })),
        {
          in: 'query',
          name: 'status',
          schema: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] },
        },
        {
          in: 'query',
          name: 'kind',
          schema: { type: 'string', enum: ['ADD_SESSION', 'VOID_SESSION'] },
        },
        { in: 'query', name: 'cursor', schema: { type: 'string', maxLength: 512 } },
        {
          in: 'query',
          name: 'limit',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        },
      ],
      responses: response('AttendanceChangeRequestPage'),
    },
  },
  '/v1/businesses/{businessId}/attendance-change-requests/{requestId}/cancel': {
    post: write(
      'cancelAttendanceChange',
      'CancelAttendanceChangeInput',
      'AttendanceChangeRequest',
      '200',
      true,
    ),
  },
  '/v1/businesses/{businessId}/attendance-change-requests/{requestId}/decide': {
    post: write(
      'decideAttendanceChange',
      'DecideAttendanceChangeInput',
      'AttendanceChangeDecisionResult',
      '200',
      true,
    ),
  },
};
