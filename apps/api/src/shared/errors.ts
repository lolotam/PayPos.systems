import type { ErrorEnvelope } from '@pospay/contracts';
import { errorMessages, type ErrorMessageCode } from '@pospay/i18n';

// Every error the API returns and its HTTP status; the messages, in both languages, live in packages/i18n (CLAUDE.md
// §6, §7). A new code is added to both, never inlined — the type refuses a code with no message.
const STATUS = {
  SCHEDULE_WEEK_INVALID: 400,
  SCHEDULE_SHIFT_INVALID: 400,
  SCHEDULE_SHIFT_OVERLAP: 409,
  SCHEDULE_LOCAL_TIME_INVALID: 400,
  SCHEDULE_EMPLOYEE_INELIGIBLE: 400,
  SCHEDULE_PAST_REASON_REQUIRED: 400,
  SCHEDULE_REVISION_CONFLICT: 409,
  SCHEDULE_APPLY_CONFLICT: 409,
  SCHEDULE_APPLY_BATCH_TOO_LARGE: 422,
  SCHEDULE_REPLACE_REASON_REQUIRED: 400,
  SCHEDULE_TEMPLATE_ARCHIVED: 409,
  EMPLOYEE_REVISION_CONFLICT: 409,
  EMPLOYEE_PRIMARY_BRANCH_REQUIRED: 400,
  EMPLOYEE_BRANCH_DATE_BEFORE_START: 400,
  EMPLOYEE_BRANCH_HISTORY_OVERLAP: 409,
  EMPLOYEE_BRANCH_HISTORY_IMMUTABLE: 409,
  STORAGE_NOT_CONFIGURED: 503,
  STORAGE_UNAVAILABLE: 503,
  FILE_NOT_FOUND: 404,
  FILE_NOT_READY: 409,
  FILE_TYPE_INVALID: 415,
  FILE_SIZE_INVALID: 413,
  FILE_CONTENT_INVALID: 422,
  EMPLOYEE_BUSINESS_NOT_FOUND: 404,
  EMPLOYEE_BRANCH_NOT_FOUND: 404,
  EMPLOYEE_USER_LINK_UNAVAILABLE: 400,
  EMPLOYEE_CONTRACT_END_BEFORE_HIRE: 400,
  EMPLOYEE_USER_ALREADY_LINKED: 409,
  PERMISSION_NOT_HELD: 403,
  PERMISSION_SELF_EDIT: 403,
  PERMISSION_OWNER_PROTECTED: 403,
  PERMISSION_SCOPE_OUTSIDE_REACH: 403,
  PERMISSION_ROLE_FORBIDDEN: 403,
  PERMISSION_OVERRIDE_ENDED: 409,
  TRANSACTION_RETRY_REQUIRED: 409,
  VALIDATION_FAILED: 400,
  INVALID_CUSTOMER_PHONE: 400,
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  AUTHENTICATION_FAILED: 401,
  FORBIDDEN: 403,
  FEATURE_DISABLED: 403,
  PAIRING_CODE_INVALID: 400,
  DEVICE_PENDING: 409,
  DEVICE_NOT_PENDING: 409,
  PIN_INVALID: 401,
  PIN_LOCKED: 423,
  OTP_UNAVAILABLE: 503,
  OTP_INVALID: 401,
  PASSKEY_ALREADY_BOUND: 409,
  PASSKEY_INVALID: 400,
  PASSKEY_SELF_UNBIND: 403,
  PASSKEY_REVISION_CONFLICT: 409,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  PAYLOAD_TOO_LARGE: 413,
  URI_TOO_LONG: 414,
  UNSUPPORTED_MEDIA_TYPE: 415,
  TOO_MANY_REQUESTS: 429,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_IN_PROGRESS: 409,
  IDEMPOTENCY_KEY_REUSED: 422,
  NOT_READY: 503,
  INTERNAL_ERROR: 500,
} as const satisfies Record<ErrorMessageCode, number>;

export type ErrorCode = keyof typeof STATUS;

// Codes that describe one specific failure the API itself detected. A bare framework status (a 409 or
// 422 from somewhere else) must never be reported as one of them.
const RAISED_BY_THE_API_ONLY: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'PASSKEY_SELF_UNBIND',
  'PASSKEY_REVISION_CONFLICT',
  'SCHEDULE_WEEK_INVALID',
  'SCHEDULE_SHIFT_INVALID',
  'SCHEDULE_SHIFT_OVERLAP',
  'SCHEDULE_LOCAL_TIME_INVALID',
  'SCHEDULE_EMPLOYEE_INELIGIBLE',
  'SCHEDULE_PAST_REASON_REQUIRED',
  'SCHEDULE_REVISION_CONFLICT',
  'SCHEDULE_APPLY_CONFLICT',
  'SCHEDULE_APPLY_BATCH_TOO_LARGE',
  'SCHEDULE_REPLACE_REASON_REQUIRED',
  'SCHEDULE_TEMPLATE_ARCHIVED',
  'EMPLOYEE_REVISION_CONFLICT',
  'EMPLOYEE_PRIMARY_BRANCH_REQUIRED',
  'EMPLOYEE_BRANCH_DATE_BEFORE_START',
  'EMPLOYEE_BRANCH_HISTORY_OVERLAP',
  'EMPLOYEE_BRANCH_HISTORY_IMMUTABLE',
  'STORAGE_NOT_CONFIGURED',
  'STORAGE_UNAVAILABLE',
  'FILE_NOT_FOUND',
  'FILE_NOT_READY',
  'FILE_TYPE_INVALID',
  'FILE_SIZE_INVALID',
  'FILE_CONTENT_INVALID',
  'EMPLOYEE_BUSINESS_NOT_FOUND',
  'EMPLOYEE_BRANCH_NOT_FOUND',
  'EMPLOYEE_USER_LINK_UNAVAILABLE',
  'EMPLOYEE_CONTRACT_END_BEFORE_HIRE',
  'EMPLOYEE_USER_ALREADY_LINKED',
  'PERMISSION_NOT_HELD',
  'PERMISSION_SELF_EDIT',
  'PERMISSION_OWNER_PROTECTED',
  'PERMISSION_SCOPE_OUTSIDE_REACH',
  'PERMISSION_ROLE_FORBIDDEN',
  'PERMISSION_OVERRIDE_ENDED',
  'TRANSACTION_RETRY_REQUIRED',
  'VALIDATION_FAILED',
  'INVALID_CUSTOMER_PHONE',
  'AUTHENTICATION_FAILED',
  'FEATURE_DISABLED',
  'PAIRING_CODE_INVALID',
  'DEVICE_PENDING',
  'DEVICE_NOT_PENDING',
  'PIN_INVALID',
  'PIN_LOCKED',
  'OTP_UNAVAILABLE',
  'OTP_INVALID',
  'PASSKEY_ALREADY_BOUND',
  'PASSKEY_INVALID',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_IN_PROGRESS',
  'IDEMPOTENCY_KEY_REUSED',
]);

/**
 * An error that reaches the client as the bilingual envelope. `details` must never carry secrets or
 * another tenant's data — it is returned as-is.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, details?: unknown) {
    super(errorMessages(code).message_en);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return STATUS[this.code];
  }

  toEnvelope(): ErrorEnvelope {
    return {
      code: this.code,
      ...errorMessages(this.code),
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

/**
 * Maps a framework HTTP status (a route that does not exist, a wrong method, an oversized body) to a
 * catalogued code. A catalogued status keeps its code; any other 4xx is a malformed request (400); any
 * 5xx — or anything else — is an internal error (500).
 *
 * @param status the status the framework chose
 * @returns the catalogued code
 */
export function codeForStatus(status: number): ErrorCode {
  const found = (Object.keys(STATUS) as ErrorCode[]).find(
    (code) => STATUS[code] === status && !RAISED_BY_THE_API_ONLY.has(code),
  );
  if (found !== undefined) return found;
  return status >= 400 && status < 500 ? 'BAD_REQUEST' : 'INTERNAL_ERROR';
}
