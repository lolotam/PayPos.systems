export interface PushAdmission {
  /** يحجز سعة اشتراك واحد خارج المعاملة، فالحدّ بحدود منتج عدّان.
   *
   * @param subscriptionId معرّف الاشتراك
   */
  reserve(subscriptionId: string): Promise<boolean>;
}
