const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * الشهور من شهر المصدر حتى الشهر الحالي للنشاط شاملين، تصاعديًا: هي كل المرشحين لهدف الترحيل (D-13)، وتُقفل
 * كلها في نداء قفل واحد قبل أي اختيار (D-3). الشهر الحالي هو آخر شهر يمكن أن يكون DRAFT لأن الشهر الذي لم
 * ينتهِ لا يُراجَع.
 *
 * @param from شهر المصدر بصيغة YYYY-MM
 * @param through الشهر الحالي للنشاط بصيغة YYYY-MM
 * @returns الشهور من `from` إلى `through`، فارغة لو `from` بعد `through`
 * @throws RangeError لصيغة شهر غير صالحة
 */
export function periodsFromThrough(from: string, through: string): string[] {
  const start = MONTH.exec(from);
  const end = MONTH.exec(through);
  if (start === null || end === null)
    throw new RangeError(`Invalid period range: ${from}..${through}`);
  let year = Number(start[1]);
  let month = Number(start[2]);
  const lastYear = Number(end[1]);
  const lastMonth = Number(end[2]);
  const periods: string[] = [];
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    periods.push(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return periods;
}
