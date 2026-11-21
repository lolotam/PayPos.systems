/** إعادة قراءة صلاحية مفتاح المرتجعات المستوردة تحت الأقفال تجعل سحب التفويض المتزامن يمنع الكتابة. */
export interface ImportedRefundsAccess {
  /**
   * بيقفل الشركة النشطة والعضويات والنشاط ثم يقرر صلاحية المفتاح على النشاط.
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
