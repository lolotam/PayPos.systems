/** استعادة طلبات شركة واحدة فقط؛ التحديث مشروط لحماية الالتزام الذي سبق المسح. */
export interface ImportRecoveryTransactions {
  /**
   * يقرأ دفعة محدودة من معرفات الطلبات القديمة دون قفل موظفين أو شركات.
   *
   * @param companyId شركة الجدول الدوري المكتشفة من outbox
   * @param before الحد الشامل لوقت الطلب
   */
  candidates(companyId: string, before: Date): Promise<readonly string[]>;
  /**
   * يفشل الطلب فقط إذا بقي قديماً ومعلقاً، فلا يكتب فوق نتيجة وظيفة سبقت التحديث.
   *
   * @param companyId شركة الطلب
   * @param previewId المعاينة المرشحة
   * @param before الحد الذي أعطى الترشيح
   */
  failStale(companyId: string, previewId: string, before: Date): Promise<void>;
}
