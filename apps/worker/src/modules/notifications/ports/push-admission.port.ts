export interface PushAdmission {
  /** يحجز سعة اشتراك واحد خارج المعاملة، فالحدّ بحدود منتج عدّان.
   * يرجّع false لما تنتهي سعة الاشتراك في الدقيقة، ويرمي خطأ لما يتعذّر الوصول لتخزين القبول (Redis)
   * فتفضل المحاولة PENDING وتُعاد مع إعادة المهمة.
   *
   * @param subscriptionId معرّف الاشتراك
   */
  reserve(subscriptionId: string): Promise<boolean>;
}
