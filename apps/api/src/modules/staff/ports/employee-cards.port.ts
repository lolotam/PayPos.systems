/** نطاق إدارة كارت الموظف: الشركة والنشاط والموظف والعامل المسجّل. */
export interface EmployeeCardScope {
  readonly companyId: string;
  readonly businessId: string;
  readonly employeeId: string;
  readonly operatorId: string;
}
/** ما يُعاد للواجهة والتخزين المؤقت: لاحقة الكود فقط، لا الكود الكامل. */
export interface EmployeeCardRecord {
  readonly id: string;
  readonly employeeId: string;
  readonly cardCodeSuffix: string;
  readonly issuedAt: string;
  readonly revokedAt: string | null;
}
/** يحمل key و fingerprint حتى يربط المحوّل إعادة المحاولة بالرد المخزّن. */
export interface EmployeeCardIdempotency {
  readonly key: string;
  readonly fingerprint: string;
}
/** الإصدار والإلغاء كتابات واحدة مؤدّبة داخل معاملة واحدة. */
export interface EmployeeCardsPort {
  /**
   * يصدر كارتاً نشطاً ويستبدل النشط السابق للموظف في نفس المعاملة.
   *
   * @param scope نطاق الموظف والعامل
   * @param cardCode الكود بعد التطبيع
   * @param idem مفتاح منع التكرار وبصمة الطلب
   */
  issue(
    scope: EmployeeCardScope,
    cardCode: string,
    idem: EmployeeCardIdempotency,
  ): Promise<EmployeeCardRecord>;
  /**
   * يلغي الكارت النشط المطابق فقط.
   *
   * @param scope نطاق الموظف والعامل
   * @param cardId الكارت المطلوب إلغاؤه
   * @param idem مفتاح منع التكرار وبصمة الطلب
   */
  revoke(
    scope: EmployeeCardScope,
    cardId: string,
    idem: EmployeeCardIdempotency,
  ): Promise<EmployeeCardRecord>;
  /**
   * يعيد الكارت المخزّن لمفتاح مكتمل بنفس البصمة عندما يغيب مؤشر Redis، دون كتابة.
   *
   * @param scope نطاق الموظف والعامل
   * @param idem مفتاح منع التكرار وبصمة الطلب
   * @returns الكارت المخزّن، أو null إن لم تكتمل نفس البصمة
   */
  completedIssue(
    scope: EmployeeCardScope,
    idem: EmployeeCardIdempotency,
  ): Promise<EmployeeCardRecord | null>;
}
