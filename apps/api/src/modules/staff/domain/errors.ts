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
