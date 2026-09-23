import type { ErrorEnvelope } from '@pospay/contracts';

// Every error the API returns, in both languages (CLAUDE.md §6). A new code is added here, never inlined.
const CATALOG = {
  VALIDATION_FAILED: {
    status: 400,
    ar: 'البيانات المرسلة غير صحيحة',
    en: 'The request is not valid',
  },
  BAD_REQUEST: { status: 400, ar: 'الطلب غير صالح', en: 'The request is malformed' },
  NOT_FOUND: { status: 404, ar: 'المسار غير موجود', en: 'Not found' },
  METHOD_NOT_ALLOWED: { status: 405, ar: 'الطريقة غير مسموحة', en: 'Method not allowed' },
  PAYLOAD_TOO_LARGE: { status: 413, ar: 'حجم الطلب كبير جداً', en: 'Payload too large' },
  URI_TOO_LONG: { status: 414, ar: 'الرابط طويل جداً', en: 'URI too long' },
  UNSUPPORTED_MEDIA_TYPE: {
    status: 415,
    ar: 'نوع المحتوى غير مدعوم',
    en: 'Unsupported media type',
  },
  NOT_READY: {
    status: 503,
    ar: 'الخدمة غير جاهزة حالياً',
    en: 'The service is not ready',
  },
  INTERNAL_ERROR: {
    status: 500,
    ar: 'حدث خطأ غير متوقع',
    en: 'An unexpected error occurred',
  },
} as const;

export type ErrorCode = keyof typeof CATALOG;

/**
 * An error that reaches the client as the bilingual envelope. `details` must never carry secrets or
 * another tenant's data — it is returned as-is.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, details?: unknown) {
    super(CATALOG[code].en);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return CATALOG[this.code].status;
  }

  toEnvelope(): ErrorEnvelope {
    const { ar, en } = CATALOG[this.code];
    return {
      code: this.code,
      message_ar: ar,
      message_en: en,
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
  const found = (Object.keys(CATALOG) as ErrorCode[]).find(
    (code) => CATALOG[code].status === status && code !== 'VALIDATION_FAILED',
  );
  if (found !== undefined) return found;
  return status >= 400 && status < 500 ? 'BAD_REQUEST' : 'INTERNAL_ERROR';
}
