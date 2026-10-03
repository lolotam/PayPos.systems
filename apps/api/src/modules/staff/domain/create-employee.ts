/** بيانات الموظف التي لا تحتوي على اعتماد دخول أو راتب. */
export interface EmployeeRecord {
  readonly id: string;
  readonly business_id: string;
  readonly primary_branch_id: string;
  readonly name_ar: string | null;
  readonly name_en: string;
  readonly role_code:
    | 'owner'
    | 'general_manager'
    | 'accountant'
    | 'business_manager'
    | 'branch_manager'
    | 'shift_supervisor'
    | 'cashier'
    | 'waiter'
    | 'kitchen'
    | 'storekeeper'
    | 'staff'
    | 'marketing'
    | 'viewer';
  readonly hire_date: string;
  readonly contract_end: string | null;
  readonly user_id: string | null;
  readonly created_at: string;
}
/** الحالة المقروءة داخل معاملة الإنشاء، بدون أسماء أو معرفات لشركة أخرى. */
export interface EmployeeCreationContext {
  readonly businessExists: boolean;
  readonly branchBusinessId: string | null;
}
/** رفض آمن لا يحمل صفوف قاعدة البيانات أو معاملات السائق. */
export class EmployeeCreationError extends Error {
  /**
   * ينشئ رفضاً مسمى يمكن تحويله إلى رسالة عربية وإنجليزية دون كشف البيانات.
   *
   * @param code سبب الرفض الآمن
   */
  constructor(
    readonly code:
      | 'EMPLOYEE_BUSINESS_NOT_FOUND'
      | 'EMPLOYEE_BRANCH_NOT_FOUND'
      | 'EMPLOYEE_BRANCH_BUSINESS_MISMATCH'
      | 'EMPLOYEE_CONTRACT_END_BEFORE_HIRE'
      | 'EMPLOYEE_USER_ALREADY_LINKED'
      | 'EMPLOYEE_USER_LINK_UNAVAILABLE'
      | 'EMPLOYEE_REVISION_CONFLICT'
      | 'EMPLOYEE_PRIMARY_BRANCH_REQUIRED'
      | 'EMPLOYEE_BRANCH_DATE_BEFORE_START'
      | 'NOT_FOUND'
      | 'FEATURE_DISABLED'
      | 'FORBIDDEN'
      | 'TRANSACTION_RETRY_REQUIRED',
  ) {
    super(code);
    this.name = 'EmployeeCreationError';
  }
}
/**
 * يثبت تبعية الفرع للنشاط وترتيب تواريخ العقد؛ قرار المالك 2026-10-03 يسمح بالتعيين المستقبلي والأسماء المكررة.
 *
 * @param record بيانات الموظف المراد إنشاؤه
 * @param context وجود النشاط وتبعية الفرع داخل الشركة
 * @returns لا شيء عند السماح، ويرفض بخطأ مسمى عند تعارض الحدود أو تواريخ العقد
 */
export function validateEmployeeCreation(
  record: EmployeeRecord,
  context: EmployeeCreationContext,
): void {
  if (!context.businessExists) throw new EmployeeCreationError('EMPLOYEE_BUSINESS_NOT_FOUND');
  if (context.branchBusinessId === null)
    throw new EmployeeCreationError('EMPLOYEE_BRANCH_NOT_FOUND');
  if (context.branchBusinessId !== record.business_id)
    throw new EmployeeCreationError('EMPLOYEE_BRANCH_BUSINESS_MISMATCH');
  if (record.contract_end !== null && record.contract_end < record.hire_date)
    throw new EmployeeCreationError('EMPLOYEE_CONTRACT_END_BEFORE_HIRE');
}
