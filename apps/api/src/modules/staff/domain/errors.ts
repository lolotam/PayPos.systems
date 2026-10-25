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

/** رفض طلب أو استلام كشف الحضور يحمل كوداً موحداً لمحول HTTP في الجولات المختلفة. */
export class AttendanceStatementError extends Error {
  /**
   * يحفظ سبب الرفض دون كشف بيانات نشاط أو مستند لمستخدم غير مصرح له.
   *
   * @param code كود رفض كشف الحضور
   */
  constructor(
    readonly code:
      | 'BRANCH_NOT_FOUND'
      | 'PERIOD_INVALID'
      | 'SHIFT_FILTER_INVALID'
      | 'EMPLOYEE_NOT_FOUND'
      | 'RATE_LIMITED'
      | 'RENDERER_UNAVAILABLE'
      | 'NOT_FOUND'
      | 'NOT_READY'
      | 'EXPIRED',
  ) {
    super(code);
  }
}
