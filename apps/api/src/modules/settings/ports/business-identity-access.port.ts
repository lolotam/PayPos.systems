/** إعادة قراءة صلاحية هوية النشاط تحت الأقفال تمنع قبول نسخة صلاحيات اتسحبت أثناء الانتظار. */
export interface BusinessIdentityAccess {
  /**
   * بيقفل الشركة النشطة والعضويات والنشاط ثم يقرر صلاحية هوية النشاط.
   *
   * @param businessId النشاط المطلوب
   */
  check(businessId: string): Promise<'FORBIDDEN' | null>;
  /**
   * بيعيد القرار بعد قفل صف الإعدادات، من غير أقفال جديدة.
   *
   * @param businessId النشاط المطلوب في نفس المعاملة
   */
  recheck(businessId: string): Promise<'FORBIDDEN' | null>;
}
