/**
 * حد لعدد المحاولات في Redis (CLAUDE.md §8، ADR-0003 §6) — لكل route عام أو حساس.
 */
export interface RateLimiter {
  /**
   * بيحسب محاولة واحدة للمفتاح ده في الشباك الحالي.
   *
   * @param key           مين بيحاول وعلى إيه (مثلاً عنوان الـ IP واسم الـ route)
   * @param limit         أقصى عدد في الشباك
   * @param windowSeconds طول الشباك
   * @returns true لو لسه في الحد، false لو عدّاه
   */
  hit(key: string, limit: number, windowSeconds: number): Promise<boolean>;
  /**
   * يثبت اكتمال المفتاح حتى لا تُحتسب إعادته داخل الشباك.
   *
   * @param key المفتاح المكتمل
   * @param windowSeconds مدة بقاء العلامة
   */
  remember(key: string, windowSeconds: number): Promise<void>;
  /**
   * يميّز مفتاحاً اكتمل داخل الشباك الحالي.
   *
   * @param key المفتاح المطلوب تمييزه
   * @returns true لو العلامة موجودة
   */
  remembered(key: string): Promise<boolean>;
  /**
   * الثواني الباقية في شباك المفتاح، حتى يضبط المسار إعادة المحاولة على الشباك الحقيقي لا على قيمة ثابتة.
   *
   * @param key نفس مفتاح hit
   * @returns الثواني الباقية، أو 0 لو المفتاح غير موجود
   */
  remaining(key: string): Promise<number>;
}
