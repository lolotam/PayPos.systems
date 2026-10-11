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
export const attendanceCorrectionPaths = {
  '/v1/businesses/{businessId}/attendance-sessions/{sessionId}/correct': {
    post: {
      operationId: 'correctAttendanceSession',
      parameters: [company, path('businessId'), path('sessionId'), idem],
      requestBody: { required: true, content: json('CorrectAttendanceInput') },
      responses: {
        '200': {
          description: 'CorrectAttendanceResult',
          content: json('CorrectAttendanceResult'),
        },
        '409': {
          description:
            'ATTENDANCE_SESSION_OPEN, ATTENDANCE_SESSION_VOIDED or ATTENDANCE_SESSION_REVISION_CONFLICT',
          content: json('ErrorEnvelope'),
        },
        default: { description: 'Bilingual refusal', content: json('ErrorEnvelope') },
      },
    },
  },
};
