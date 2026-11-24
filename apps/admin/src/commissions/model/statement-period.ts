/**
 * الشهر اللي الشاشة تفتح عليه: الشهر اللي قبل شهر النهاردة على ساعة المتصفح، لأنه آخر شهر خلص وده اللي
 * بيتعمل كشفه. السيرفر هو اللي بيفصل في خلوص الشهر بتوقيت النشاط، فاللي بيفتح شهر لسه ما خلصش بياخد رفضه.
 *
 * @param now اللحظة الحالية
 * @returns الشهر بصيغة YYYY-MM
 */
export function defaultStatementPeriod(now: Date): string {
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month = now.getMonth() === 0 ? 12 : now.getMonth();
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}
