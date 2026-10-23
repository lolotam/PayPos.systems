/** مفاتيح اشتراك الدفع: الدالة البحتة في packages/notifications، والموديول بياخدها من port مش مباشرة. */
export interface PushKeys {
  /**
   * بيتأكد إن مفتاحي الاشتراك شكلهم صح — عشان التشفير بعدين ما يفشلش على اشتراك حيّ.
   *
   * @param p256dh المفتاح العام للمتصفح
   * @param auth   مفتاح المصادقة
   * @returns true بس لو المفتاحين دول صحّين
   */
  validSubscriptionKeys(p256dh: string, auth: string): boolean;
}
