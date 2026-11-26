import { renderEmailLayout } from './email-layout.ts';

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

/** أصول لوحة الإدارة المسموح إرسال روابط عليها؛ أي أصل تاني يُرفض قبل الإرسال. */
const ADMIN_ORIGINS: readonly string[] = [
  'https://app.pospay.systems',
  'https://app.staging.pospay.systems',
];

/**
 * يرسم بريد تشغيلي واحد بالتخطيط الموحّد: نفس الجدول وال header والتذييل لكل رسالة.
 * الأصل بيتفحص قبل أي بناء، فلو مش من الأصول المسموحة ما بتبعتش رسالة أصلاً.
 *
 * @param key مفتاح القالب
 * @param revision مراجعة القالب
 * @param locale لغة الرسالة
 * @param parameters معاملات القالب الآمنة
 * @param adminOrigin أصل لوحة الإدارة
 * @returns البريد بصيغتيه، أو null لما القالب أو الأصل مش على-spec
 */
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
  if (!ADMIN_ORIGINS.includes(adminOrigin)) return null;
  const copy = COPY[locale as 'ar' | 'en'];
  const link = `${adminOrigin}/`;
  const layout = renderEmailLayout({
    locale: locale as 'ar' | 'en',
    adminOrigin,
    title: copy.subject,
    bodyHtml: `<p style="margin:0;">${copy.body}</p>`,
    bodyText: copy.body,
    action: { label: copy.action, url: link },
  });
  return { subject: copy.subject, text: layout.text, html: layout.html };
}
