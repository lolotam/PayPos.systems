import { isValidCustomerBirthdayCalendar } from '@pospay/domain';

import { InvalidCustomerProfileError } from './errors.ts';

/** تاريخ الميلاد كما بتيجي من العقد: يوم وشهر مع بعض، والسنة اختيارية. */
export interface CustomerBirthday {
  readonly day: number;
  readonly month: number;
  // العقد بيسيب الحقل غايب أو undefined صراحةً، فالنوع لازم يسمح بالاتنين (exactOptionalPropertyTypes).
  readonly year?: number | undefined;
}

/**
 * تاريخ الميلاد قبل الفحص: ممكن يوصل ناقص (يوم من غير شهر أو العكس)، ورفض النقص
 * شغل الـ domain نفسه — فالمدخل لازم يسمح بالحالتين.
 */
export type CustomerBirthdayInput = Partial<CustomerBirthday>;

// نفس نطاق حروف التحكم اللي العقد والـ CHECK بيستخدموه (C0 و DEL و C1).
const CONTROL_CHARACTERS = new RegExp(`[\\x00-\\x1F\\x7F-\\x9F]`);

// Postgres مش بيخزّن NUL أصلاً، فبنقارنه بالرمز نفسه مش بترميزه.
const NUL = String.fromCharCode(0);

/**
 * بيتأكد إن تاريخ الميلاد شكله تقويمي: يوم وشهر مع بعض، واليوم موجود في شهره،
 * و29 فبراير بس في سنة كبيسة. نفس قاعدة customers_birthday_shape في قاعدة البيانات،
 * والقاعدة نفسها بقت في @pospay/domain عشان الواجهة تستخدمها بدل نسخة تانية.
 *
 * @param birthday تاريخ الميلاد كما وصل، وقد يكون ناقص (يوم من غير شهر أو العكس)
 * @returns لا شيء؛ بيحط InvalidCustomerProfileError من غير أي قيمة في الرسالة
 */
export function validateBirthday(birthday: CustomerBirthdayInput): void {
  if (!isValidCustomerBirthdayCalendar(birthday)) throw new InvalidCustomerProfileError();
}

/**
 * بيتأكد إن البريد بالشكل اللي بيقبله العقد والـ CHECK: @ ونقطة، من غير مسافات برّه،
 * من 3 لـ 254 نقطة، ومن غير حروف تحكم. القاعدة الحرفية بتاعة CI-Q11.
 *
 * @param value البريد كما وصل من العقد
 * @returns true لو البريد بالشكل المسموح
 */
export function isEmailShape(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed !== value) return false;
  const length = [...trimmed].length;
  if (length < 3 || length > 254) return false;
  if (!trimmed.includes('@') || !trimmed.includes('.')) return false;
  return !CONTROL_CHARACTERS.test(trimmed);
}

/**
 * بيعدّ نقاط الملاحظة، لأن العقد والـ CHECK بيقيسوا الطول بالـ code points مش بوحدات UTF-16.
 *
 * @param value الملاحظة كما وصلت
 * @returns عدد نقاط النص
 */
export function noteLength(value: string): number {
  return [...value].length;
}

/**
 * بيتأكد إن الملاحظة بالشكل المسموح: من 1 لـ 500 نقطة من غير مسافات برّه، ومن غير NUL.
 * الـ NUL مرفوض هنا لأن Postgres مش بيخزّنه أصلاً، فلازم يتشال قبل ما يوصل القاعدة.
 *
 * @param value الملاحظة كما وصلت
 * @returns true لو الملاحظة بالشكل المسموح
 */
export function isNoteShape(value: string): boolean {
  if (value.includes(NUL)) return false;
  const trimmed = value.trim();
  if (trimmed !== value) return false;
  const length = noteLength(trimmed);
  return length >= 1 && length <= 500;
}
