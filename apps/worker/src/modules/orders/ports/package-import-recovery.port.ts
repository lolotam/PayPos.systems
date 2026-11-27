/** استعادة طلبات تثبيت شركة واحدة بتحديث مشروط واحد لكل صفحة، دون مساس بطلب تثبيت جارٍ. */
export interface PackageImportRecoveryTransactions {
  /**
   * يفشل صفحة واحدة من الطلبات العالقة غير المقفولة ويعيد عددها؛ صفر يعني لا شيء متاح الآن.
   *
   * @param companyId هوية المستأجر
   * @param before الحد الشامل لوقت قبول الطلب من الساعة المحقونة
   * @returns عدد الطلبات التي فشلت فعليًا في هذه الصفحة
   */
  failStalePage(companyId: string, before: Date): Promise<number>;
  /**
   * يفحص وجود طلب تثبيت استيراد باقات معلق واحد على الأقل لشركة، ليعرف مسح الاكتشاف إن كانت تحتاج جدولة استعادة.
   *
   * @param companyId الشركة المفحوصة
   * @returns true لو في طلب معلق
   */
  hasPending(companyId: string): Promise<boolean>;
}
