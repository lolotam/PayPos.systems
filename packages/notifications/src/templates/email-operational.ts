export interface EmailContent {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

// TODO(spec): اعتماد النسخة ar/en من المالك قبل التفعيل؛ لا تحتوي تفاصيل موظف أو مستند.
const COPY = {
  ar: {
    subject: 'تنبيه انتهاء مستند',
    body: 'يوجد مستند موظف يقترب موعد انتهائه.',
    action: 'افتح لوحة الإدارة بعد تسجيل الدخول.',
  },
  en: {
    subject: 'Document expiry alert',
    body: 'An employee document is nearing expiry.',
    action: 'Sign in to the admin dashboard to review it.',
  },
} as const;

export function renderOperationalEmail(
  key: string,
  revision: number,
  locale: string,
  parameters: readonly unknown[],
  adminOrigin: string,
): EmailContent | null {
  if (
    key !== 'document_expiring' ||
    revision !== 1 ||
    !['ar', 'en'].includes(locale) ||
    parameters.length !== 0
  )
    return null;
  if (!['https://app.pospay.systems', 'https://app.staging.pospay.systems'].includes(adminOrigin))
    return null;
  const copy = COPY[locale as 'ar' | 'en'];
  const link = `${adminOrigin}/`;
  return {
    subject: copy.subject,
    text: `${copy.body}\n${copy.action}\n${link}`,
    html: `<html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><body><p>${copy.body}</p><a href="${link}">${copy.action}</a></body></html>`,
  };
}
