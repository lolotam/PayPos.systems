/** إعادة قراءة سلطة المدير تحت الأقفال تمنع قبول نسخة صلاحيات قديمة. */
export interface BusinessDiscountAccess {
  /**
   * بيعيد قرار صلاحيات النشاط والفروع ووقت القرار بعد انتظار الأقفال.
   *
   * @param businessId النشاط المطلوب
   */
  check(businessId: string): Promise<{
    failure: 'FORBIDDEN' | 'PERMISSION_NOT_HELD' | 'PERMISSION_SCOPE_OUTSIDE_REACH' | null;
    decidedAt: string | null;
  }>;
}
