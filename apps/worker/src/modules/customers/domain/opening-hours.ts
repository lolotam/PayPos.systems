/** فترة عمل بصيغة HH:MM؛ closes الأصغر من opens يعني أن الفترة تعبر منتصف الليل. */
export interface OpeningInterval {
  readonly opens: string;
  readonly closes: string;
}

/** فترات يوم عمل بترقيم ISO من 1 للاتنين إلى 7 للحد. */
export interface OpeningDay {
  readonly weekday: number;
  readonly intervals: readonly OpeningInterval[];
}

/** مواعيد الفرع؛ غياب اليوم يعني أنه مغلق. */
export type OpeningHoursValue = readonly OpeningDay[];

/**
 * يحوّل ساعة حائط إلى دقائق منذ منتصف الليل المحلي لمقارنة فترات العمل.
 *
 * @param clock الوقت بصيغة HH:MM
 * @returns عدد الدقائق منذ 00:00
 */
export function clockMinutes(clock: string): number {
  const [hours = '0', minutes = '0'] = clock.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/**
 * يحدد أن الإغلاق يقع في اليوم المدني التالي، لأن closes يسبق opens على ساعة الحائط.
 *
 * @param interval فترة العمل
 * @returns true عندما تعبر الفترة منتصف الليل
 */
export function crossesMidnight(interval: OpeningInterval): boolean {
  return clockMinutes(interval.closes) < clockMinutes(interval.opens);
}
