/** استعادة طلبات تثبيت خدمات شركة واحدة بتحديث مشروط واحد لكل صفحة، دون مساس بطلب تثبيت جارٍ. */
export interface ServiceImportRecoveryTransactions {
  /**
   * يفشل صفحة واحدة من الطلبات العالقة غير المقفولة ويعيد عددها؛ صفر يعني لا شيء متاح الآن.
   *
   * @param companyId هوية المستأجر
   * @param before الحد الشامل لوقت قبول الطلب من الساعة المحقونة
   * @returns عدد الطلبات التي فشلت فعليًا في هذه الصفحة
   */
  failStalePage(companyId: string, before: Date): Promise<number>;
}
