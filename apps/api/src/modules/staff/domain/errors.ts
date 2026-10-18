/** رفض تعديل الرقم الوظيفي يترجم في HTTP دون كشف وجود موظفة في نشاط آخر. */
export class SetEmployeeNumberError extends Error {
  /**
   * يحمل كود الرفض إلى محول HTTP.
   *
   * @param code كود الرفض
   */
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'FORBIDDEN'
      | 'FEATURE_DISABLED'
      | 'EMPLOYEE_NUMBER_TAKEN'
      | 'TRANSACTION_RETRY_REQUIRED',
  ) {
    super(code);
  }
}

/** رفض ضبط بداية الترقيم: مرة واحدة، وبعد إعادة فحص الصلاحية والميزة داخل المعاملة. */
export class SetEmployeeNumberStartError extends Error {
  /**
   * يحمل كود الرفض إلى محول HTTP.
   *
   * @param code كود الرفض
   */
  constructor(
    readonly code:
      | 'FORBIDDEN'
      | 'FEATURE_DISABLED'
      | 'EMPLOYEE_NUMBER_START_ALREADY_SET'
      | 'TRANSACTION_RETRY_REQUIRED',
  ) {
    super(code);
  }
}
