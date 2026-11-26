/** استعادة طلبات بيع شركة واحدة بتحديث مشروط لا يتجاوز نتيجة بيع جارٍ. */
export interface PackageSaleRecoveryTransactions {
  /**
   * يعيد حتى 50 معرفاً للطلبات القديمة المعلقة على دفعات حتى تستنفد الاستعادة المرشحين.
   *
   * @param companyId شركة الجدول الدوري المكتشفة من outbox
   * @param before الحد الشامل لوقت قبول الطلب
   */
  candidates(companyId: string, before: Date): Promise<readonly string[]>;
  /**
   * يفشل الطلب إذا بقي قديماً ومعلقاً، ويثبت لحظة القرار دون الكتابة فوق بيع مكتمل.
   *
   * @param companyId شركة الطلب
   * @param requestId طلب البيع المرشح
   * @param before الحد الذي أعطى الترشيح
   * @param at لحظة تثبيت الفشل من الساعة المحقونة
   */
  failStale(companyId: string, requestId: string, before: Date, at: string): Promise<void>;
  /**
   * يفحص وجود طلب بيع معلق واحد على الأقل لشركة، ليعرف مسح الاكتشاف إن كانت تحتاج جدولة استعادة.
   *
   * @param companyId الشركة المفحوصة
   * @returns true لو في طلب معلق
   */
  hasPending(companyId: string): Promise<boolean>;
}
