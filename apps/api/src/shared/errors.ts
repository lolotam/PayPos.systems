import type { ErrorEnvelope } from '@pospay/contracts';
import { errorMessages, type ErrorMessageCode } from '@pospay/i18n';

// Every error the API returns and its HTTP status; the messages, in both languages, live in packages/i18n (CLAUDE.md
// §6, §7). A new code is added to both, never inlined — the type refuses a code with no message.
const STATUS = {
  VALIDATION_FAILED: 400,
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
  'VALIDATION_FAILED',
  'AUTHENTICATION_FAILED',
  'FEATURE_DISABLED',
  'PAIRING_CODE_INVALID',
  'DEVICE_PENDING',
  'DEVICE_NOT_PENDING',
  'PIN_INVALID',
  'PIN_LOCKED',
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
