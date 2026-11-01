/** هوية الطلب التي يُشتق منها رابط التقييم، وهي نفسها هوية الـ HMAC (ADR-0057). */
export interface RatingTokenIdentity {
  readonly companyId: string;
  readonly ratingRequestId: string;
}

/** بصمة الرابط وإصدار المفتاح الذي اشتُقّت منه؛ النص نفسه لا يخرج من حزمة auth. */
export interface RatingTokenClaim {
  readonly tokenHash: Uint8Array;
  readonly keyVersion: number;
}

/** اشتقاق بصمة رابط التقييم، وقدرة مستقلة عن قدرة إرسال الرابط (ADR-0057 §1). */
export interface RatingTokenPort {
  /**
   * يشتق بصمة الرابط من هوية الطلب، أو يرجع null لما القدرة غير جاهزة.
   *
   * @param identity هوية الشركة وطلب التقييم
   * @returns البصمة وإصدار المفتاح، أو null
   */
  claim(identity: RatingTokenIdentity): RatingTokenClaim | null;
}

/** كود اشتقاق البصمة كما تبنيه حزمة auth؛ المفتاح نفسه ما بيعديش الجذر. */
export interface RatingTokenDeriver {
  /**
   * يشتق بصمة الرابط من هوية الطلب.
   *
   * @param identity هوية الشركة وطلب التقييم
   * @returns البصمة وإصدار المفتاح
   */
  claim(identity: RatingTokenIdentity): RatingTokenClaim;
}
