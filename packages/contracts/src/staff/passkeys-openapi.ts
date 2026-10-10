const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});
function operation(operationId: string, status: string, response?: string, body?: string) {
  return {
    operationId,
    ...(body === undefined ? {} : { requestBody: { required: true, content: json(body) } }),
    responses: {
      [status]: {
        description: operationId,
        ...(response === undefined ? {} : { content: json(response) }),
      },
      default: { description: 'Error envelope', content: json('ErrorEnvelope') },
    },
  };
}
export const passkeyPaths = {
  '/v1/staff/personal-otp/request': {
    post: operation(
      'requestPersonalOtp',
      '202',
      'StaffOtpAcknowledgement',
      'PersonalOtpRequestInput',
    ),
  },
  '/v1/staff/personal-otp/verify': {
    post: operation('verifyPersonalOtp', '200', 'PersonalSessionContext', 'PersonalOtpVerifyInput'),
  },
  '/v1/staff/personal-session': {
    get: operation('getPersonalSession', '200', 'PersonalSessionContext'),
  },
  '/v1/staff/personal-session/sign-out': { post: operation('signOutPersonalStaff', '200') },
  '/v1/staff/my-schedule': {
    get: {
      ...operation('getPersonalSchedule', '200', 'PersonalSchedule'),
      parameters: [
        {
          name: 'branch_id',
          in: 'query',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
        {
          name: 'week_start',
          in: 'query',
          required: true,
          schema: { type: 'string', format: 'date' },
        },
      ],
    },
  },
  '/v1/staff/passkey': {
    get: operation('getPersonalPasskeyBinding', '200', 'PasskeyBindingStatus'),
  },
  '/v1/staff/passkey/options': {
    post: {
      ...operation('generatePersonalPasskeyOptions', '200', 'PasskeyRegistrationOptions'),
      requestBody: { required: false, content: json('PasskeyOptionsInput') },
    },
  },
  '/v1/staff/passkey/verify': {
    post: operation('enrolPersonalPasskey', '201', 'PasskeyBindingStatus', 'PasskeyVerifyInput'),
  },
};
