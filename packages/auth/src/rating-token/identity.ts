const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface RatingTokenIdentity {
  readonly companyId: string;
  readonly ratingRequestId: string;
}

/** خطأ ثابت بلا معرّفات حتى لا تتسرب مدخلات الرابط إلى السجلات. */
export class RatingTokenIdentityError extends Error {
  readonly code = 'RATING_TOKEN_IDENTITY_INVALID';

  constructor() {
    super('Invalid rating token identity');
    this.name = 'RatingTokenIdentityError';
  }
}

/**
 * يفرض الصيغة canonical للمعرّفين لأن أي اختلاف نصي يغيّر الـ HMAC والرابط.
 *
 * @param identity هوية الشركة وطلب التقييم المستخدمة في اشتقاق الرابط
 * @returns لا شيء عندما تكون الهوية صالحة
 * @throws {RatingTokenIdentityError} عندما لا يكون أي من المعرّفين UUID canonical صغيراً
 */
export function assertRatingTokenIdentity(identity: RatingTokenIdentity): void {
  if (!CANONICAL_UUID.test(identity.companyId) || !CANONICAL_UUID.test(identity.ratingRequestId))
    throw new RatingTokenIdentityError();
}
