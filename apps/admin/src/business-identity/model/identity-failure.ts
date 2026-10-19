import { t, type ErrorMessageCode, type Locale } from '@pospay/i18n';

const KNOWN: readonly ErrorMessageCode[] = [
  'FORBIDDEN',
  'FILE_NOT_FOUND',
  'FILE_NOT_READY',
  'FILE_TYPE_INVALID',
  'FILE_SIZE_INVALID',
  'FILE_CONTENT_INVALID',
  'VALIDATION_FAILED',
  'STORAGE_NOT_CONFIGURED',
  'STORAGE_UNAVAILABLE',
];

const REJECTION = new Set<ErrorMessageCode>([
  'FILE_TYPE_INVALID',
  'FILE_SIZE_INVALID',
  'FILE_CONTENT_INVALID',
]);

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  return value as Record<string, unknown>;
}

export function errorCode(error: unknown): string | undefined {
  const code = record(error)?.code;
  return typeof code === 'string' ? code : undefined;
}

export function errorStatus(error: unknown): number | undefined {
  const status = record(error)?.status;
  return typeof status === 'number' ? status : undefined;
}

function knownCode(code: string | undefined): ErrorMessageCode | undefined {
  if (!code) return undefined;
  return (KNOWN as readonly string[]).includes(code) ? (code as ErrorMessageCode) : undefined;
}

export function isLogoRejection(error: unknown): boolean {
  const code = knownCode(errorCode(error));
  return code !== undefined && REJECTION.has(code);
}

export function isIdentityReadForbidden(error: unknown): boolean {
  return errorStatus(error) === 403 || errorCode(error) === 'FORBIDDEN';
}

function envelopeText(error: unknown, locale: Locale): string | undefined {
  const body = record(error);
  const arabic = body?.message_ar;
  const english = body?.message_en;
  if (typeof arabic !== 'string' || typeof english !== 'string') return undefined;
  return locale === 'ar' ? arabic : english;
}

/** نص الظرف لو موجود، وإلا رسالة الكود. 403 من غير ظرف يبقى errors.FORBIDDEN. */
export function identityFailureMessage(error: unknown, locale: Locale): string {
  const text = envelopeText(error, locale);
  if (text) return text;
  if (errorStatus(error) === 403) return t(locale, 'errors.FORBIDDEN');
  const code = knownCode(errorCode(error));
  if (code) return t(locale, `errors.${code}`);
  return t(locale, 'admin.unexpected');
}
