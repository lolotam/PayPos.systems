const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});

const errors = {
  '400': {
    description: 'Request validation error (malformed body or password length)',
    content: json('ErrorEnvelope'),
  },
  '403': { description: 'FORBIDDEN: untrusted origin', content: json('ErrorEnvelope') },
  '429': { description: 'TOO_MANY_REQUESTS with Retry-After', content: json('ErrorEnvelope') },
  '503': { description: 'OTP_UNAVAILABLE', content: json('ErrorEnvelope') },
  default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
};

// استرجاع كلمة المرور بكود الإيميل (spec 079 PR-b): مسارات عامة بلا جلسة، محمية بـ rate limit.
export const passwordResetOtpPaths = {
  '/v1/auth/password-reset/otp/request': {
    post: {
      operationId: 'requestPasswordResetOtp',
      security: [],
      requestBody: { required: true, content: json('PasswordResetOtpRequestInput') },
      responses: {
        '202': {
          description: 'Indistinguishable acknowledgment',
          content: json('PasswordResetOtpAcknowledgement'),
        },
        ...errors,
      },
    },
  },
  '/v1/auth/password-reset/otp/reset': {
    post: {
      operationId: 'resetPasswordWithOtp',
      security: [],
      requestBody: { required: true, content: json('PasswordResetOtpResetInput') },
      responses: {
        '200': {
          description: 'Password changed; every session ended, no session issued',
          content: json('PasswordResetOtpResult'),
        },
        '401': { description: 'OTP_INVALID', content: json('ErrorEnvelope') },
        ...errors,
      },
    },
  },
};
