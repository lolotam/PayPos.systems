const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});
function operation(operationId: string, input: string, result: string, idempotent = false) {
  return {
    operationId,
    ...(idempotent
      ? {
          parameters: [
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: true,
              schema: { type: 'string', minLength: 1, maxLength: 255 },
            },
          ],
        }
      : {}),
    requestBody: { required: true, content: json(input) },
    responses: {
      '200': { description: operationId, content: json(result) },
      default: { description: 'Error envelope', content: json('ErrorEnvelope') },
    },
  };
}
export const clockAttendancePaths = {
  '/v1/staff/attendance/challenge': {
    post: operation('requestAttendanceClockChallenge', 'ClockChallengeInput', 'ClockChallenge'),
  },
  '/v1/staff/attendance/clock': {
    post: operation(
      'clockPersonalAttendance',
      'ClockAttendanceInput',
      'ClockAttendanceResult',
      true,
    ),
  },
};
