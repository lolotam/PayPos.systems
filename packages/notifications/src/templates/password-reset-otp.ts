import { renderEmailLayout } from './email-layout.ts';

/** مفتاح قالب استرجاع كلمة المرور بالإيميل — نفس المفتاح في سجل الاعتماد. */
export const PASSWORD_RESET_OTP_KEY = 'password_reset_otp';
/** مراجعة القالب: نسخة واحدة معتمدة، أي تغيير بياخد مراجعة جديدة. */
export const PASSWORD_RESET_OTP_REVISION = 1;

/** نص رسالة اعتماد بلغتين: الرمز، مدة الصلاحية، وتحذير عدم المشاركة. */
export interface OtpEmailCopy {
  readonly subject: string;
  readonly intro: string;
  readonly label: string;
  readonly expiry: string;
  readonly share: string;
}

/** نسخ القالب بلغتين: الرمز، مدة الصلاحية، وتحذير عدم المشاركة. */
const COPY: Record<'ar' | 'en', OtpEmailCopy> = {
  ar: {
    subject: 'رمز إعادة تعيين كلمة المرور',
    intro: 'طلبت إعادة تعيين كلمة المرور لحسابك في PosPay. استخدم الرمز التالي:',
    label: 'رمز التحقق',
    expiry: 'الرمز صالح لمدة 10 دقائق فقط من وقت طلبه.',
    share: 'لا تشارك الرمز مع أي حد، ولا تديه لأي حد طلبه منك على التليفون.',
  },
  en: {
    subject: 'PosPay password reset code',
    intro: 'You asked to reset your PosPay password. Use this code:',
    label: 'Verification code',
    expiry: 'The code is valid for 10 minutes only from the moment you requested it.',
    share: 'Do not share the code with anyone, and never give it to anyone who calls you.',
  },
};

/** النتيجة: بريد بصيغتيه أو null لما القالب أو الرمز مش مطابق للمواصفة. */
export interface PasswordResetEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/**
 * يرسم بريد استرجاع كلمة المرور: الرمز ظاهر وكبير، ومدة الصلاحية والتحذير تحته.
 *
 * @param revision مراجعة القالب
 * @param locale لغة الرسالة
 * @param code الرمز المكوّن من ستة أرقام
 * @param adminOrigin أصل لوحة الإدارة الآمن، ومصدر صورة الهوية
 * @returns البريد بصيغتيه، أو null لما القالب أو الرمز مش مطابق للمواصفة
 */
export function renderPasswordResetEmail(
  revision: number,
  locale: string,
  code: unknown,
  adminOrigin: string,
): PasswordResetEmail | null {
  if (revision !== PASSWORD_RESET_OTP_REVISION || !['ar', 'en'].includes(locale)) return null;
  return renderOtpEmail(COPY[locale as 'ar' | 'en'], locale as 'ar' | 'en', code, adminOrigin);
}

/**
 * يرسم بريد اعتماد بالتخطيط الموحّد: الرمز ظاهر وكبير، ومدة الصلاحية والتحذير تحته. مشترك بين
 * اعتماد كلمة المرور واعتماد الرقم السري عشان الشكل يفضل واحد.
 *
 * @param copy نص الرسالة بلغتها
 * @param locale لغة الرسالة
 * @param code الرمز المكوّن من ستة أرقام
 * @param adminOrigin أصل لوحة الإدارة الآمن، ومصدر صورة الهوية
 * @returns البريد بصيغتيه، أو null لما الرمز مش مطابق للمواصفة
 */
export function renderOtpEmail(
  copy: OtpEmailCopy,
  locale: 'ar' | 'en',
  code: unknown,
  adminOrigin: string,
): PasswordResetEmail | null {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const codeStyle =
    'margin:16px 0 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#FF6421;';
  const noteStyle = 'margin:12px 0 0 0;font-size:13px;line-height:1.6;color:#5A6675;';
  const layout = renderEmailLayout({
    locale,
    adminOrigin,
    title: copy.subject,
    bodyHtml: `<p style="margin:0;">${copy.intro}</p>
      <p style="margin:8px 0 0 0;font-size:13px;color:#5A6675;">${copy.label}</p>
      <p style="${codeStyle}">${code}</p>
      <p style="${noteStyle}">${copy.expiry}</p>
      <p style="${noteStyle}">${copy.share}</p>`,
    bodyText: `${copy.intro}\n${copy.label}: ${code}\n${copy.expiry}\n${copy.share}`,
  });
  return { subject: copy.subject, text: layout.text, html: layout.html };
}
