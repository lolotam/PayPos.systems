const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});

export const clockByCardPaths = {
  '/v1/devices/me/clock-by-card': {
    post: {
      operationId: 'clockByCard',
      description:
        'Clock a staff member by their attendance card on the paired device; requires the Device credential and a signed-in operator holding clock:attendance:branch.',
      parameters: [
        {
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
          schema: { type: 'string', minLength: 1, maxLength: 255 },
        },
      ],
      requestBody: { required: true, content: json('ClockByCardInput') },
      responses: {
        '200': {
          description: 'Accepted attendance movement',
          content: json('ClockAttendanceResult'),
        },
        default: { description: 'Error envelope', content: json('ErrorEnvelope') },
      },
      security: [{ DeviceToken: [], KioskStaffSession: [] }],
    },
  },
};
