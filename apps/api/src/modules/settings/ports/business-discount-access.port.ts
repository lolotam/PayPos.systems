/** إعادة قراءة سلطة المدير تحت الأقفال تمنع قبول نسخة صلاحيات قديمة. */
export interface BusinessDiscountAccess {
  /**
   * بيعيد القرار الحالي بعد قفل صف الإعدادات، بدون أقفال جديدة؛ check سبق وثبت الشركة والعضويات.
   *
   * @param businessId النشاط المطلوب في نفس المعاملة
   */
  recheck(businessId: string): ReturnType<BusinessDiscountAccess['check']>;
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
