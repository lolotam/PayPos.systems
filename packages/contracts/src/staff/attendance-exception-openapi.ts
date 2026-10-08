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
const operation = (operationId: string) => ({
  operationId,
  parameters: [company, path('businessId'), path('exceptionId'), idem],
  requestBody: { required: true, content: json('AttendanceExceptionDecisionInput') },
  responses: {
    '200': {
      description: 'AttendanceExceptionRecord',
      content: json('AttendanceExceptionRecord'),
    },
    default: { description: 'Bilingual refusal', content: json('ErrorEnvelope') },
  },
});
export const attendanceExceptionPaths = {
  '/v1/businesses/{businessId}/attendance-exceptions/{exceptionId}/resolve': {
    post: operation('resolveAttendanceException'),
  },
  '/v1/businesses/{businessId}/attendance-exceptions/{exceptionId}/reopen': {
    post: operation('reopenAttendanceException'),
  },
};
