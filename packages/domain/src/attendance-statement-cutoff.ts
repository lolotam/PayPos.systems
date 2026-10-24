import { defaultShiftMinutes } from './default-shifts.js';
import type { WeekdayDefaultShift } from './default-shifts.js';
import type { ReportShift } from './attendance-report-types.js';

/**
 * يبني منسق التوقيت المحلي للمنطقة مرة واحدة؛ كل مقارنة بلحظة بتستخدمه.
 *
 * @param timezone منطقة الفرع
 * @returns منسق يطلع السنة والشهر واليوم والساعة والدقيقة بالوقت المحلي
 */
export function attendanceLocalFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/**
 * يحوّل لحظة إلى دقيقة بالوقت المحلي للمنطقة؛ المقياس ده بيخلّي مقارنة «قبل الطلب» تتم بالساعة مش بالنص.
 * الرقم بيتحسب من 1 يناير 1970 بساعة الحائط المحلية للحظة دي، عشان لحظتين في يومين مختلفين يبقوا قابلين للمقارنة.
 *
 * @param instant اللحظة بصيغة ISO
 * @param formatter منسق المنطقة المحلية
 * @returns الدقائق من 1 يناير 1970 بساعة الحائط المحلية للحظة دي
 */
export function attendanceLocalMinute(instant: string, formatter: Intl.DateTimeFormat): number {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return Date.parse(`${parts['year']}-${parts['month']}-${parts['day']}T00:00:00Z`) / 60_000 +
    Number(parts['hour']) * 60 + Number(parts['minute']);
}

/**
 * يقول إن الوردية خلصت قبل الطلب؛ الوردية اللي ما خلصتش ما بتضيفش دقايق مجدولة (FR-013a).
 * الوردية اللي عبرت منتصف الليل بتقارن بنهاية اليوم اللي بعده.
 *
 * @param shift الوردية المقروءة
 * @param cutoff لحظة الطلب أو null لما مفيش حد
 * @returns هل خلصت الوردية قبل الطلب
 */
export function attendanceShiftHasEnded(shift: ReportShift, cutoff: string | null): boolean {
  return cutoff === null || Date.parse(shift.ends_at) <= Date.parse(cutoff);
}

/**
 * يقول إن دوام اليوم الافتراضي خلص قبل الطلب؛ دوام يعدي نص الليل بيخلص في اليوم اللي بعده (BR-12).
 * النهاية بالضبط عند الطلب بتعدي؛ الدوام اللي ما خلصش ما بيتحسبش خالص.
 *
 * @param date يوم العمل المحلي
 * @param entry دوام اليوم الافتراضي
 * @param cutoffMinute دقيقة الطلب بالوقت المحلي للمنطقة
 * @returns هل خلص الدوام قبل الطلب
 */
export function attendanceContractEntryEnded(date: string, entry: WeekdayDefaultShift, cutoffMinute: number): boolean {
  const start = Number(entry.start.slice(0, 2)) * 60 + Number(entry.start.slice(3, 5));
  const end = Date.parse(`${date}T00:00:00Z`) / 60_000 + start + defaultShiftMinutes(entry);
  return end <= cutoffMinute;
}
