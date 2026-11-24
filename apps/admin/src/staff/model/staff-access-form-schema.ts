import { zodResolver } from '@hookform/resolvers/zod';
import { grantStaffAccessInput, type GrantStaffAccessInput } from '@pospay/contracts';

/** نفس عقد السيرفر بالحرف: هاتف كانوني وتأكيد إجباري ودور من اتنين ورقم سري من أربعة أرقام. */
export const staffAccessResolver = zodResolver(grantStaffAccessInput);

/**
 * قيم البداية: `phone_confirmed` تبدأ غير معلَّمة (`false` كنوع `true` لأن العقد literal) عشان
 * resolver يرفض الحفظ قبل التأكيد ويظهر نص التأكيد الإجباري (D10).
 */
export const staffAccessDefaults = {
  phone: '',
  phone_confirmed: false as true,
  role: 'staff',
  pin: '',
} satisfies GrantStaffAccessInput;

/** هل رفض الطلب جاء من رفض الخادم المعروف (409/403/404) أم خطأ آخر؟ الرسائل تجيء من الحزمة مباشرة. */
export function staffAccessErrorCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object' || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
