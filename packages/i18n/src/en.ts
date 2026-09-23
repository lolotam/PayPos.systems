// The English catalog — the reference: every key here must exist in ar.ts (the type makes a missing one a build error).
export const en = {
  errors: {
    VALIDATION_FAILED: 'The request is not valid',
    BAD_REQUEST: 'The request is malformed',
    UNAUTHENTICATED: 'Authentication is required',
    AUTHENTICATION_FAILED: 'Authentication failed',
    FORBIDDEN: 'This action is not allowed',
    FEATURE_DISABLED: 'This feature is not enabled for your company',
    PAIRING_CODE_INVALID: 'The pairing code is invalid or has expired',
    DEVICE_PENDING: 'The device is waiting for a manager to approve it',
    DEVICE_NOT_PENDING: 'No device in this branch is waiting for approval with this id',
    PIN_INVALID: 'The PIN is incorrect',
    PIN_LOCKED: 'The PIN is locked after too many wrong attempts — try again in 15 minutes',
    NOT_FOUND: 'Not found',
    METHOD_NOT_ALLOWED: 'Method not allowed',
    PAYLOAD_TOO_LARGE: 'Payload too large',
    URI_TOO_LONG: 'URI too long',
    UNSUPPORTED_MEDIA_TYPE: 'Unsupported media type',
    TOO_MANY_REQUESTS: 'Too many requests — try again shortly',
    IDEMPOTENCY_KEY_REQUIRED:
      'An Idempotency-Key header of 1–255 visible ASCII characters is required',
    IDEMPOTENCY_KEY_IN_PROGRESS:
      'A request with this Idempotency-Key is still in progress — retry shortly',
    IDEMPOTENCY_KEY_REUSED: 'This Idempotency-Key was already used with a different request',
    NOT_READY: 'The service is not ready',
    INTERNAL_ERROR: 'An unexpected error occurred',
  },
} as const;
