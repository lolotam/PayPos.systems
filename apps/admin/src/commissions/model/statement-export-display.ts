import { commissionStatementRenderErrors, t, type Locale, type MessageKey } from '@pospay/i18n';

const NS = 'commissionStatementScreen';

/** مفتاح نص لكل كود رفض أو فشل معروف؛ الأكواد دي ما بتتعرضش للمستخدم أبدًا. */
const CODE_KEYS: Readonly<Record<string, MessageKey>> = {
  STATEMENT_EMPTY: `${NS}.exportErrEmpty`,
  DOCUMENT_TOO_LARGE: `${NS}.exportErrTooLarge`,
  DOCUMENT_RENDER_TIMEOUT: `${NS}.exportErrTimeout`,
  DOCUMENT_RENDER_FAILED: `${NS}.exportErrFailed`,
  DOCUMENT_KIND_UNKNOWN: `${NS}.exportErrFailed`,
  RENDERER_UNAVAILABLE: `${NS}.exportErrRenderer`,
  COMMISSION_STATEMENT_NOT_APPROVED: `${NS}.exportErrNotApproved`,
  COMMISSION_STATEMENT_EXPORT_RATE_LIMITED: `${NS}.exportErrRateLimited`,
  FORBIDDEN: `${NS}.errForbidden`,
  FEATURE_DISABLED: `${NS}.errFeatureDisabled`,
  DOCUMENT_EXPIRED: `${NS}.exportExpired`,
  DOCUMENT_NOT_READY: `${NS}.exportTimeout`,
};

function codeOf(error: unknown): string | undefined {
  const value = (error as { code?: unknown } | null)?.code;
  return typeof value === 'string' ? value : undefined;
}

function statusOf(error: unknown): number | undefined {
  const value = (error as { status?: unknown } | null)?.status;
  return typeof value === 'number' ? value : undefined;
}

/**
 * نص مقروء لرفض أو فشل في مسار التصدير بلغة الشاشة. الكود المعروف له نصه، وكود عدم الإتاحة من كتالوج الـ worker،
 * و404 معناه إن الطلب مش موجود أو انتهى؛ وأي حاجة تانية بتاخد الرسالة العامة، ومفيش كود خام بيتعرض.
 *
 * @param error الرفض أو كود الفشل زي ما جه من السيرفر
 * @param locale لغة الشاشة
 * @returns الرسالة المقروءة
 */
export function exportFailureText(error: unknown, locale: Locale): string {
  const code = codeOf(error);
  if (code === 'COMMISSION_STATEMENT_UNAVAILABLE') {
    const message = commissionStatementRenderErrors.COMMISSION_STATEMENT_UNAVAILABLE;
    return locale === 'ar' ? message.message_ar : message.message_en;
  }
  const key = code === undefined ? undefined : CODE_KEYS[code];
  if (key !== undefined) return t(locale, key);
  const status = statusOf(error);
  if (status === 404 || status === 410) return t(locale, `${NS}.exportExpired`);
  if (status === 403) return t(locale, `${NS}.errForbidden`);
  return t(locale, `${NS}.exportErrGeneric`);
}

/** هل الرفض معناه إن الملف انتهى ومينفعش يتحمّل تاني (404 أو 410)؟ */
export function exportExpired(error: unknown): boolean {
  const status = statusOf(error);
  return status === 404 || status === 410 || codeOf(error) === 'DOCUMENT_EXPIRED';
}

/** اسم الملف بيتبني في المتصفح من الشهر. */
export function statementExportFileName(period: string): string {
  return `commission-statement-${period}.xlsx`;
}
