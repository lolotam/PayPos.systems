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
}
