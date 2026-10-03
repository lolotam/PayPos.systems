import { ScheduleError } from './schedule-types.ts';
const DAY_MS = 86_400_000;

/**
 * يضيف أياماً مدنية دون الاعتماد على توقيت الخادم أو طول يوم التوقيت الصيفي.
 *
 * @param date التاريخ الميلادي
 * @param days عدد الأيام
 * @returns التاريخ المدني الناتج
 */
export function addScheduleDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
/**
 * يرفض أسبوعاً لا يبدأ السبت حتى تتفق شاشة المدير وتقارير الحضور على حدود الأسبوع.
 *
 * @param weekStart يوم البداية
 * @returns لا قيمة؛ يرمي الخطأ المسمى عند الرفض
 */
export function validateScheduleWeek(weekStart: string): void {
  const at = new Date(`${weekStart}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) ||
    !Number.isFinite(at.getTime()) ||
    at.toISOString().slice(0, 10) !== weekStart ||
    at.getUTCDay() !== 6
  )
    throw new ScheduleError('SCHEDULE_WEEK_INVALID');
}
function localFormatter(timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}
function localParts(at: number, formatter: Intl.DateTimeFormat) {
  const parts = formatter.formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}
/**
 * يحول ساعة الفرع للحظة UTC فريدة؛ رفض فجوة أو تكرار الساعة يحمي المدة من اختيار صامت.
 *
 * @param date يوم البداية المحلي
 * @param time الساعة المحلية
 * @param timezone منطقة الفرع المحلولة
 * @returns لحظة UTC بصيغة ISO
 */
export function scheduleInstant(date: string, time: string, timezone: string): string {
  const wall = `${date}T${time}:00`;
  const nominal = Date.parse(`${wall}Z`);
  const matches = new Set<number>();
  try {
    const formatter = localFormatter(timezone);
    for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
      const sample = nominal + hours * 3_600_000;
      const offset = Date.parse(`${localParts(sample, formatter)}Z`) - sample;
      const candidate = nominal - offset;
      if (localParts(candidate, formatter) === wall) matches.add(candidate);
    }
  } catch {
    throw new ScheduleError('SCHEDULE_LOCAL_TIME_INVALID');
  }
  // TODO(spec) SC-Q2: تأكيد رفض الساعة المكررة أو غير الموجودة بدلاً من اختيار offset تلقائي.
  if (matches.size !== 1) throw new ScheduleError('SCHEDULE_LOCAL_TIME_INVALID');
  const [unique] = matches;
  if (unique === undefined) throw new ScheduleError('SCHEDULE_LOCAL_TIME_INVALID');
  return new Date(unique).toISOString();
}
/**
 * تاريخ اليوم مصدره ساعة محقونة ومنطقة الفرع، فلا يتغير شرط السبب مع مكان المدير.
 *
 * @param now اللحظة المحقونة
 * @param timezone المنطقة المحلولة
 * @returns اليوم المحلي
 */
export function scheduleToday(now: Date, timezone: string): string {
  return localParts(now.getTime(), localFormatter(timezone)).slice(0, 10);
}
