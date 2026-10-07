import { moneyToString, parseMoney } from '@pospay/domain';

/**
 * يطبع مبلغ الإدخال بثلاث خانات عبر الفلس الصحيح؛ يبقي النص غير الصالح كي يرفضه عقد النموذج.
 *
 * @param text نص الدينار الذي كتبه المستخدم، دون تحويل إلى float
 * @returns نص KWD قياسي أو النص الأصلي عند عدم اكتماله أو خروجه عن حدود المال
 */
export function normalizeKwdInput(text: string): string {
  try {
    return moneyToString(parseMoney(text));
  } catch {
    return text;
  }
}
