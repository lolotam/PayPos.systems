/**
 * هل الشهر خلص في توقيت النشاط؟ لازم يكون قبل شهر اليوم المحلي (FR-025، D-16): شهر اليوم نفسه ما خلصش
 * وهو لسه بيدخله شغل، فكشفه يتولد بعد نهايته مش قبلها.
 *
 * @param period شهر الكشف بصيغة YYYY-MM
 * @param today تاريخ اليوم المحلي للنشاط بصيغة YYYY-MM-DD
 * @returns هل الشهر انتهى
 */
export function isStatementPeriodEnded(period: string, today: string): boolean {
  return period < today.slice(0, 7);
}
