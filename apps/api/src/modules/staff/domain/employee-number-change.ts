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

/** قبل وبعد الرقم كما يُكتبان في التدقيق حتى لا يختلف الصف عن السجل. */
export interface EmployeeNumberAudit {
  before: { employee_number: number | null };
  after: { employee_number: number };
}

/**
 * يميز تغيير الرقم عن إبقاء نفس القيمة حتى لا يُقفل العدّاد ولا يُكتب تدقيق على طلب بلا أثر.
 * الرقم ما زال يقبل الفراغ حتى يكتمل الإسناد، فالمرور من فراغ إلى رقم تغيير حقيقي.
 *
 * @param before الرقم المحفوظ، وقد يكون فارغاً
 * @param after الرقم المطلوب
 * @returns null عند التطابق، وإلا قبل وبعد للتدقيق
 */
export function employeeNumberChange(
  before: number | null,
  after: number,
): EmployeeNumberAudit | null {
  if (before === after) return null;
  return { before: { employee_number: before }, after: { employee_number: after } };
}
