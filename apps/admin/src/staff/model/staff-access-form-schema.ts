import { zodResolver } from '@hookform/resolvers/zod';
import {
  changeEmployeeStaffPhoneInput,
  grantStaffAccessInput,
  resetEmployeeStaffPinInput,
  type ChangeEmployeeStaffPhoneInput,
  type GrantStaffAccessInput,
  type ResetEmployeeStaffPinInput,
} from '@pospay/contracts';

/** نفس عقد السيرفر بالحرف: هاتف كانوني وتأكيد إجباري ودور من اتنين ورقم سري من أربعة أرقام. */
export const staffAccessResolver = zodResolver(grantStaffAccessInput);

/** نفس عقد السيرفر بالحرف: رقم سري من أربعة أرقام بس — مفيش غيره في جسم إعادة الضبط. */
export const resetStaffPinResolver = zodResolver(resetEmployeeStaffPinInput);

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

/** نفس عقد السيرفر بالحرف: هاتف كانوني وتأكيد إجباري ورقم سري مؤقت من أربعة أرقام. */
export const changePhoneResolver = zodResolver(changeEmployeeStaffPhoneInput);

/** قيم بداية تغيير الهاتف: التأكيد غير معلَّم (`false` كنوع `true`) فيرفض resolver الحفظ قبله. */
export const changePhoneDefaults = {
  phone: '',
  phone_confirmed: false as true,
  pin: '',
} satisfies ChangeEmployeeStaffPhoneInput;

/** قيمة بداية نموذج إعادة الضبط: رقم سري فاضي لحد ما المدير يكتبه. */
export const resetStaffPinDefaults = { pin: '' } satisfies ResetEmployeeStaffPinInput;

/** هل رفض الطلب جاء من رفض الخادم المعروف (409/403/404) أم خطأ آخر؟ الرسائل تجيء من الحزمة مباشرة. */
export function staffAccessErrorCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object' || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
