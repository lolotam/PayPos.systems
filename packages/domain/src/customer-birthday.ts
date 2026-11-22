/**
 * قاعدة التقويم المشتركة لتاريخ الميلاد: يوم وشهر مع بعض، والسنة اختيارية.
 * المنطق نقي بلا أخطاء ولا رسائل؛ كل مستهلك يترجم النتيجة لخطأ بالشكل اللي يريده.
 */
export interface CustomerBirthdayCalendarInput {
  readonly day?: number | undefined;
  readonly month?: number | undefined;
  readonly year?: number | undefined;
}

// عدد أيام كل شهر؛ فبراير بيقبل 29 بس في السنة الكبيسة.
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * بيتحقق من شكل التاريخ التقويمي من غير ما يحدد كيفية عرض الخطأ.
 * السنة الغايبة معناها يوم وشهر بس، فـ 29 فبراير مقبول من غير سنة.
 *
 * @param birthday اليوم والشهر والسنة الاختيارية كما وصلوا
 * @returns true لو التاريخ ممكن تقويمياً وفق قاعدة العملاء
 */
export function isValidCustomerBirthdayCalendar(birthday: CustomerBirthdayCalendarInput): boolean {
  const { day, month, year } = birthday;
  if (day === undefined || month === undefined) return false;
  if (!Number.isInteger(day) || !Number.isInteger(month)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  if (day > (DAYS_IN_MONTH[month - 1] ?? 31)) return false;
  if (year === undefined) return true;
  if (!Number.isInteger(year) || year < 1 || year > 9999) return false;
  return !(month === 2 && day === 29 && !isLeapYear(year));
}
