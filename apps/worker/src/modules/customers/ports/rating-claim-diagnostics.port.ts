/** تشخيص طلب تقييم فشل مع استمرار باقي الطلبات وإعادة الجولة لاحقاً. */
export interface RatingClaimDiagnostics {
  /**
   * يسجل نوع الخطأ ورمزه الآمنين فقط؛ الرسالة والهاتف والرابط ومفاتيح Redis لا تُطبع.
   *
   * @param companyId الشركة المالكة للجولة
   * @param error سبب فشل الطلب قبل تنقيحه في المحول
   */
  failed(companyId: string, error: unknown): void;
}
