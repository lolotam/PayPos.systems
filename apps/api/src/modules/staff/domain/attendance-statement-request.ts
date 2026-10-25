import type { AttendanceShiftPair } from '@pospay/domain';

const DAY_MS = 86_400_000;

function utcDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return null;
  return time;
}

function currentMonthLastDay(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  return Date.UTC(year, month, 0);
}

/**
 * بيفحص حدود فترة كشف الحضور: ترتيب التاريخين، 366 يوم بحد أقصى، وعدم تجاوز الشهر الحالي.
 * سقف الشهر بيتحسب بتوقيت الفرع عشان طلب آخر لحظة في الشهر ما يقبلش أو يرفض شهر غلط.
 *
 * @param from أول يوم في الفترة بصيغة YYYY-MM-DD
 * @param to آخر يوم في الفترة بصيغة YYYY-MM-DD
 * @param now لحظة الطلب المحقونة
 * @param timezone المنطقة الزمنية الفعالة للفرع
 * @returns true لو الفترة مقبولة للطلب
 */
export function statementPeriodIsValid(
  from: string,
  to: string,
  now: Date,
  timezone: string,
): boolean {
  const first = utcDay(from);
  const last = utcDay(to);
  if (first === null || last === null || first > last) return false;
  if ((last - first) / DAY_MS + 1 > 366) return false;
  return last <= currentMonthLastDay(now, timezone);
}

/**
 * بيبني اسم ملف ASCII ثابت من نوع البيان والفترة، من غير أسماء موظفات أو فروع في الترويسة.
 *
 * @param form نوع البيان، فرع أو موظفة
 * @param from أول يوم في الفترة
 * @param to آخر يوم في الفترة
 * @returns اسم ملف PDF المطلوب للتنزيل
 */
export function statementFilename(form: 'BRANCH' | 'EMPLOYEE', from: string, to: string): string {
  return `attendance-statement-${form.toLowerCase()}-${from}_${to}.pdf`;
}

/** زوج التوقيت المحلي الذي يختار الوردية دون الاعتماد على اسم قابل للتعديل. */
export interface StatementShift {
  start: string;
  end: string;
}

/**
 * بيحوّل فلتر الشيفت الموجود لزوج الوقت اللي قواعد التغطية بتفهمه، ويثبت غيابه كـ null.
 *
 * @param shift بداية ونهاية الشيفت المحلي، أو undefined من غير فلتر
 * @returns زوج الشيفت لقواعد البيان، أو null من غير فلتر
 */
export function statementShiftPair(shift?: StatementShift): AttendanceShiftPair | null {
  return shift === undefined ? null : { start: shift.start, end: shift.end };
}
