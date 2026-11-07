/**
 * يتحقق من نافذة الشهور التقويمية، مع احتساب الشهر الحالي ضمن العدد المسموح.
 *
 * @param month الشهر الصحيح المطلوب
 * @param currentMonth الشهر الحالي في توقيت النشاط
 * @param monthsBack عدد الشهور الفعال من قارئ الإعدادات
 * @returns السماح بالشهر الحالي أو تاريخ داخل النافذة فقط
 */
export function ownWorkPeriodAllowed(
  month: string,
  currentMonth: string,
  monthsBack: number,
): boolean {
  const ordinal = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
  const age = ordinal(currentMonth) - ordinal(month);
  return age >= 0 && age < monthsBack;
}
