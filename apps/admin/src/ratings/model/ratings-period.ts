const PARTS = ['year', 'month', 'day', 'hour', 'minute', 'second'] as const;

/** فرق توقيت النطاق عن UTC بالمللي ثانية عند لحظة معينة (موجب شرق جرينتش). */
function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant));
  const [year, month, day, hour, minute, second] = PARTS.map((type) =>
    Number(parts.find((part) => part.type === type)?.value),
  ) as [number, number, number, number, number, number];
  return Date.UTC(year, month - 1, day, hour, minute, second) - Math.floor(instant / 1000) * 1000;
}

/** بداية شهر `YYYY-MM` بتوقيت النطاق كلحظة UTC، بمحاولتين عشان تغيّر التوقيت الصيفي. */
function monthStart(month: string, timeZone: string): Date {
  const [year, number] = month.split('-').map(Number) as [number, number];
  const wall = Date.UTC(year, number - 1, 1);
  const first = wall - offsetMs(wall, timeZone);
  return new Date(wall - offsetMs(first, timeZone));
}

/**
 * نطاق الشهر الذي تحدده الشاشة للطلبين: `from` شاملة و`to` حصرية على وقت التسجيل (عقد 61-2b).
 * الحدود بتوقيت الفرع المحدد لأن توقيت النشاط نفسه مش متاح في المتصفح.
 *
 * @param month الشهر بصيغة `YYYY-MM`
 * @param timeZone توقيت الفرع المحدد أو الفرع الأول عند «كل الفروع»
 * @returns بداية الشهر وبداية الشهر التالي بصيغة ISO
 */
export function ratingsMonthRange(month: string, timeZone: string): { from: string; to: string } {
  const [year, number] = month.split('-').map(Number) as [number, number];
  const next = number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`;
  return {
    from: monthStart(month, timeZone).toISOString(),
    to: monthStart(next, timeZone).toISOString(),
  };
}

/**
 * الشهر الحالي `YYYY-MM` بتوقيت النطاق، قيمة افتراضية لمحدد الشهر.
 *
 * @param now اللحظة الحالية (مُمرَّرة عشان الاختبار)
 * @param timeZone توقيت النطاق
 * @returns الشهر بصيغة `YYYY-MM`
 */
export function currentRatingsMonth(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}`;
}
