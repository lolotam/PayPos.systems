import {
  renderOtpEmail,
  type OtpEmailCopy,
  type PasswordResetEmail,
} from './password-reset-otp.ts';

/** مفتاح قالب استرجاع الرقم السري للموظف — نفس المفتاح في سجل الاعتماد. */
export const STAFF_PIN_RESET_OTP_KEY = 'staff_pin_reset_otp';
/** مراجعة القالب: نسخة واحدة معتمدة، أي تغيير بياخد مراجعة جديدة. */
export const STAFF_PIN_RESET_OTP_REVISION = 1;

/** نسخ القالب بلغتين: الرمز، مدة الصلاحية، وتحذير عدم المشاركة. */
const COPY: Record<'ar' | 'en', OtpEmailCopy> = {
  ar: {
    subject: 'رمز استعادة الرقم السري',
    intro: 'طلبت استعادة الرقم السري لدخولك على الكاشير في PosPay. استخدم الرمز التالي:',
    label: 'رمز التحقق',
    expiry: 'الرمز صالح لمدة 10 دقائق فقط من وقت طلبه.',
    share: 'لا تشارك الرمز مع أي حد، ولا تديه لأي حد طلبه منك على التليفون.',
  },
  en: {
    subject: 'PosPay PIN recovery code',
    intro: 'You asked to recover your PosPay cashier PIN. Use this code:',
    label: 'Verification code',
    expiry: 'The code is valid for 10 minutes only from the moment you requested it.',
    share: 'Do not share the code with anyone, and never give it to anyone who calls you.',
  },
};

/**
 * يرسم بريد استعادة الرقم السري للموظف بنفس تخطيط بريد كلمة المرور.
 *
 * @param revision مراجعة القالب
 * @param locale لغة الرسالة
 * @param code الرمز المكوّن من ستة أرقام
 * @param adminOrigin أصل لوحة الإدارة الآمن، ومصدر صورة الهوية
 * @returns البريد بصيغتيه، أو null لما القالب أو الرمز مش مطابق للمواصفة
 */
export function renderStaffPinResetEmail(
  revision: number,
  locale: string,
  code: unknown,
  adminOrigin: string,
): PasswordResetEmail | null {
  if (revision !== STAFF_PIN_RESET_OTP_REVISION || !['ar', 'en'].includes(locale)) return null;
  return renderOtpEmail(COPY[locale as 'ar' | 'en'], locale as 'ar' | 'en', code, adminOrigin);
}
