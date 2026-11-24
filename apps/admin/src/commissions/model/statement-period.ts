/**
 * يوم اعتماد الكشف: تاريخ UTC للحظة الاعتماد (الأدمن ما عندوش تقويم النشاط، فده تقريب).
 *
 * @param approvedAt لحظة الاعتماد بصيغة ISO
 * @returns التاريخ بصيغة YYYY-MM-DD
 */
export function approvalDay(approvedAt: string): string {
  return new Date(approvedAt).toISOString().slice(0, 10);
}

/**
 * اليوم اللي قبل تاريخ معيّن.
 *
 * @param date تاريخ بصيغة YYYY-MM-DD
 * @returns اليوم السابق بنفس الصيغة
 */
export function dayBefore(date: string): string {
  const previous = new Date(`${date}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

/**
 * يوم النهارده على ساعة المتصفح بصيغة YYYY-MM-DD، لخانة تاريخ الصرف.
 *
 * @param now اللحظة الحالية
 * @returns التاريخ
 */
export function todayInputDate(now: Date): string {
  const part = (value: number, width: number) => String(value).padStart(width, '0');
  return `${part(now.getFullYear(), 4)}-${part(now.getMonth() + 1, 2)}-${part(now.getDate(), 2)}`;
}

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
