const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** مكونات ساعة الحائط اللازمة لقواعد يوم التقييم. */
export interface LocalParts {
  readonly date: string;
  readonly minutes: number;
  readonly isoWeekday: number;
}

/**
 * يستخرج التاريخ والدقائق ويوم ISO من لحظة في منطقة الفرع، دون الاعتماد على منطقة الخادم.
 *
 * @param instant اللحظة المطلوب تحويلها
 * @param timeZone منطقة IANA الفعّالة للفرع
 * @returns تاريخ YYYY-MM-DD ودقائق اليوم ورقم weekday من 1 إلى 7
 */
export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  return {
    date,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
    isoWeekday: isoWeekdayOf(date),
  };
}

/**
 * يضيف أياماً مدنية كاملة، فلا يغيّر التوقيت الصيفي عدد الأيام المحسوب.
 *
 * @param date تاريخ البداية بصيغة YYYY-MM-DD
 * @param days عدد الأيام وقد يكون سالباً
 * @returns التاريخ المدني الناتج بصيغة YYYY-MM-DD
 */
export function addCivilDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * يحسب يوم الأسبوع لتاريخ مدني بترقيم ISO المستخدم في opening_hours.
 *
 * @param date التاريخ المدني بصيغة YYYY-MM-DD
 * @returns 1 للاتنين حتى 7 للحد
 */
export function isoWeekdayOf(date: string): number {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const local = localParts(instant, timeZone);
  const wallClockAsUtc = Date.parse(`${local.date}T00:00:00Z`) + local.minutes * MINUTE_MS;
  return wallClockAsUtc - instant.getTime();
}

/**
 * يحوّل تاريخاً ودقائق محلية إلى لحظة UTC؛ القيم من 1440 إلى 2879 تنتقل لليوم التالي.
 * يعيد حل إزاحة المنطقة مرة ثانية عند اللحظة المخمنة حتى يصححها قرب تغيير التوقيت الصيفي.
 *
 * @param date التاريخ المحلي بصيغة YYYY-MM-DD
 * @param minutes الدقائق منذ منتصف الليل وقد تتجاوز يوماً واحداً
 * @param timeZone منطقة IANA الفعّالة للفرع
 * @returns اللحظة التي تقرأ فيها ساعة الفرع التاريخ والدقائق المطلوبين
 */
export function instantOf(date: string, minutes: number, timeZone: string): Date {
  const wallClockAsUtc = Date.parse(`${date}T00:00:00Z`) + minutes * MINUTE_MS;
  const firstOffset = zoneOffsetMs(new Date(wallClockAsUtc), timeZone);
  const guessedInstant = wallClockAsUtc - firstOffset;
  const resolvedOffset = zoneOffsetMs(new Date(guessedInstant), timeZone);
  return new Date(wallClockAsUtc - resolvedOffset);
}
