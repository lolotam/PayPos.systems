/** منفذ معاملة تثبيت استيراد العملاء وفشل الطلب بعد rollback. */
export interface CustomerImportCommitTransactions {
  /**
   * يقفل المعاينة ويثبت كل صفوفها ذرياً؛ الطلب الغائب أو غير المقبول لا يفعل شيئاً.
   *
   * @param companyId هوية المستأجر
   * @param previewId هوية المعاينة
   * @param at     لحظة التثبيت المحقونة
   */
  run(companyId: string, previewId: string, at: string): Promise<void>;
  /**
   * يسجّل فشل الطلب المعلق برمز آمن بعد التراجع.
   *
   * @param companyId هوية المستأجر
   * @param previewId هوية المعاينة
   * @param code     رمز الرفض الآمن
   */
  fail(companyId: string, previewId: string, code: string): Promise<void>;
  /**
   * يفشل الطلبات العالقة في صفحة واحدة مقفولة ويعيد عددها.
   *
   * @param companyId هوية المستأجر
   * @param before   الحد الزمني الذي قبله الطلب عالق
   */
  failStalePage(companyId: string, before: number): Promise<number>;
}

/** ساعة محقونة لتوحيد لحظة التثبيت. */
export interface CustomerImportCommitClock {
  /** يعيد وقت التثبيت من الساعة المحقونة. */
  now(): Date;
}
