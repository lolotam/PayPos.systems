/**
 * يتحقق من نافذة الشهور التقويمية لتقدير عمولتي، مع احتساب الشهر الحالي ضمن العدد المسموح.
 * القاعدة نفسها قاعدة شاشات «شغلي» الأخرى، وبتتكرر هنا لأن وحدة العمولات ما بتستوردش وحدة الطلبات.
 *
 * @param month الشهر الصحيح المطلوب
 * @param currentMonth الشهر الحالي في توقيت النشاط
 * @param monthsBack عدد الشهور الفعال من قارئ الإعدادات
 * @returns السماح بالشهر الحالي أو شهر داخل النافذة فقط
 */
export function ownCommissionPeriodAllowed(
  month: string,
  currentMonth: string,
  monthsBack: number,
): boolean {
  const ordinal = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
  const age = ordinal(currentMonth) - ordinal(month);
  return age >= 0 && age < monthsBack;
}
