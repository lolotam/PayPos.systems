/**
 * بصمة توكن التقييم: التوكن نفسه ما بيتخزّنش أبداً (ADR-0011 §2)، البصمة بس.
 * الـ domain ما بيستوردش crypto، فالمحوّل هو الواجهة الوحيد بينهما.
 */
export interface RatingTokenHash {
  /**
   * يحسب بصمة SHA-256 للتوكن القانوني، وهي اللي بتتخزّن في `rating_requests.token_hash`.
   *
   * @param token الصيغة القانونية للـ token كاملة
   * @returns 32 بايت من البصمة
   */
  sha256(token: string): Buffer;
}
