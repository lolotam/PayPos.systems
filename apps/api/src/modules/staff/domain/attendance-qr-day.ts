const DAY_MS = 86_400_000;

function localDay(formatter: Intl.DateTimeFormat, instant: number): number {
  const parts = formatter.formatToParts(instant);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day')) / DAY_MS;
}

/**
 * بيحدد يوم السر ونهاية الاحتفاظ حسب منتصف الليل المحلي بقرار المالك 2026-10-03.
 * يوم التوقيت الصيفي مش لازم يكون 24 ساعة؛ السر القديم يفضل لأول نافذة بعد منتصف الليل.
 *
 * @param instant لحظة بداية نافذة الرمز بالمللي ثانية
 * @param branchTimeZone توقيت الفرع لو متحدد
 * @param businessTimeZone توقيت النشاط الاحتياطي لو توقيت الفرع مش متحدد
 * @returns رقم اليوم المحلي وتوقيت انتهاء الاحتفاظ بالسر بالمللي ثانية
 */
export function attendanceQrDay(
  instant: number,
  branchTimeZone?: string | null,
  businessTimeZone?: string | null,
): { day: number; retainUntil: number } {
  if (!Number.isSafeInteger(instant) || instant < 0 || instant > 8_640_000_000_000_000 - 2 * DAY_MS)
    throw new RangeError('Invalid attendance clock');
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone: branchTimeZone ?? businessTimeZone ?? 'Asia/Kuwait',
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const day = localDay(formatter, instant);
  let start = instant;
  let end = instant + 2 * DAY_MS;
  // البحث عن أول لحظة في اليوم التالي بيحترم انتقالات IANA بدل جمع 24 ساعة.
  while (end - start > 1) {
    const middle = start + Math.floor((end - start) / 2);
    if (localDay(formatter, middle) === day) start = middle;
    else end = middle;
  }
  return { day, retainUntil: end + 60_000 };
}
