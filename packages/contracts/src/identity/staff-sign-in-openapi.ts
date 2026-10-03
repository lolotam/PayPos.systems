const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});

function operation(
  operationId: string,
  status: '200' | '202',
  description: string,
  response: string,
  body?: string,
) {
  return {
    operationId,
    ...(body === undefined ? {} : { requestBody: { required: true, content: json(body) } }),
    responses: {
      [status]: { description, content: json(response) },
      default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
    },
  };
}

// مسارات دخول الموظف على جهاز الفرع (ADR-0019)؛ منفصلة عن openapi.ts عشان كل جزء يملك مساراته.
export const staffSignInPaths = {
  '/v1/devices/me/staff-pin/sign-in': {
    post: operation(
      'signInStaffPin',
      '200',
      'Restricted staff session',
      'StaffSessionContext',
      'StaffPinInput',
    ),
  },
  '/v1/staff-pins/reset': {
    post: {
      operationId: 'resetStaffPin',
      parameters: [
        {
          in: 'header',
          name: 'x-company-id',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      requestBody: { required: true, content: json('StaffPinResetInput') },
      responses: {
        '204': { description: 'PIN reset; no session issued' },
        default: { description: 'Error', content: json('ErrorEnvelope') },
      },
    },
  },
  '/v1/devices/me/staff-otp/request': {
    post: operation(
      'requestStaffOtp',
      '202',
      'Indistinguishable acknowledgment',
      'StaffOtpAcknowledgement',
      'StaffOtpRequestInput',
    ),
  },
  '/v1/devices/me/staff-otp/verify': {
    post: operation(
      'verifyStaffOtp',
      '200',
      'Restricted staff session',
      'StaffSessionContext',
      'StaffOtpVerifyInput',
    ),
  },
  '/v1/devices/me/staff-session': {
    get: operation('getStaffSession', '200', 'Current device operator', 'StaffSessionContext'),
  },
  '/v1/devices/me/staff-session/sign-out': {
    post: {
      operationId: 'signOutStaff',
      responses: {
        '200': { description: 'Signed out' },
        default: { description: 'Error', content: json('ErrorEnvelope') },
      },
    },
  },
};
