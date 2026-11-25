/** رفض متوقع من مسار دخول الموظفة: الكود ثابت وآمن للطباعة ولا يحمل أي بيانات عن أي حساب آخر (FR-F1-5). */
export class StaffUserRefused extends Error {
  override readonly name = 'StaffUserRefused';
  /** كود الرفض المعروف. */
  readonly code:
    | 'STAFF_ACCESS_USER_NOT_STAFF'
    | 'STAFF_ACCESS_PIN_INVALID'
    | 'STAFF_ACCESS_ROLE_MISSING'
    | 'STAFF_ACCESS_PHONE_TAKEN'
    | 'STAFF_MEMBERSHIP_NOT_ACTIVE';

  /**
   * يبني الرفض بكوده.
   *
   * @param code كود الرفض الثابت
   */
  constructor(
    code:
      | 'STAFF_ACCESS_USER_NOT_STAFF'
      | 'STAFF_ACCESS_PIN_INVALID'
      | 'STAFF_ACCESS_ROLE_MISSING'
      | 'STAFF_ACCESS_PHONE_TAKEN'
      | 'STAFF_MEMBERSHIP_NOT_ACTIVE',
  ) {
    super(code);
    this.code = code;
  }
}
