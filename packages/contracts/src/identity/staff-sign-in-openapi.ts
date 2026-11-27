const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});

function operation(
  operationId: string,
  status: '200' | '202',
  description: string,
  response: string,
  body?: string,
  forbidden?: string,
) {
  return {
    operationId,
    ...(body === undefined ? {} : { requestBody: { required: true, content: json(body) } }),
    responses: {
      [status]: { description, content: json(response) },
      ...(forbidden === undefined
        ? {}
        : { '403': { description: forbidden, content: json('ErrorEnvelope') } }),
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
      'PIN_CHANGE_REQUIRED when the PIN is temporary, PIN_EXPIRED when its 24 hours are over',
    ),
  },
  '/v1/devices/me/staff-pin/change': {
    post: {
      operationId: 'changeTemporaryStaffPin',
      requestBody: { required: true, content: json('ChangeTemporaryStaffPinInput') },
      responses: {
        '204': { description: 'The temporary PIN is now permanent; no session issued' },
        '403': {
          description:
            'PIN_EXPIRED when the temporary PIN ran out; PIN_CHANGE_REQUIRED is the sign-in refusal',
          content: json('ErrorEnvelope'),
        },
        default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
      },
    },
  },
  '/v1/devices/me/staff-pin/otp/request': {
    post: {
      operationId: 'requestStaffPinResetOtp',
      requestBody: { required: true, content: json('StaffPinResetRequestInput') },
      responses: {
        '202': {
          description: 'Indistinguishable acknowledgment',
          content: json('StaffPinResetAcknowledgement'),
        },
        '429': {
          description: 'TOO_MANY_REQUESTS with Retry-After',
          content: json('ErrorEnvelope'),
        },
        '503': {
          description: 'OTP_UNAVAILABLE for the chosen channel',
          content: json('ErrorEnvelope'),
        },
        default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
      },
    },
  },
  '/v1/devices/me/staff-pin/otp/reset': {
    post: {
      operationId: 'resetStaffPinWithOtp',
      requestBody: { required: true, content: json('StaffPinResetOtpInput') },
      responses: {
        '204': { description: 'The PIN is now permanent; no session issued' },
        '401': { description: 'OTP_INVALID', content: json('ErrorEnvelope') },
        '429': {
          description: 'TOO_MANY_REQUESTS with Retry-After',
          content: json('ErrorEnvelope'),
        },
        '503': { description: 'OTP_UNAVAILABLE', content: json('ErrorEnvelope') },
        default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
      },
    },
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
    post: operation('signOutStaff', '200', 'Signed out, or no session to end', 'SignOutResult'),
  },
};
