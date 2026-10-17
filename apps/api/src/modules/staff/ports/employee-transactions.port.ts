import type {
  EmployeeCreationContext,
  EmployeeInsertRecord,
  EmployeeRecord,
} from '../domain/create-employee.ts';

/** معاملة الموظف لا تكتب عضويات؛ امتلاك role_code وحده ليس صلاحية دخول. */
export interface EmployeeCreationScope {
  /**
   * يوحد رفض تبعية الفرع أولاً ثم يفحص الإذن والميزة تحت أقفال PR 7 لمنع سباق المنع والإنشاء.
   *
   * @param businessId النشاط المستهدف
   * @param branchId الفرع المستهدف لفحص المنع الأدق
   * @returns هل يملك الفاعل الإذن الحي؛ يرفض الفرع الخارجي أو الميزة المعطلة بخطأ مسمى
   */
  authorize(businessId: string, branchId: string): Promise<boolean>;
  /**
   * يقرأ مرجع العمل داخل الشركة كي تفحص دوال المجال تبعية الفرع للنشاط.
   *
   * @param record البيانات المطلوب فحصها
   * @returns سياق قواعد الموظف دون بيانات من شركة أخرى
   */
  context(record: EmployeeRecord): Promise<EmployeeCreationContext>;
  /**
   * يثبت عضوية المستخدم النشطة في هذه الشركة بعد الأقفال؛ الرفض لا يميز الهوية الأجنبية من المجهولة.
   *
   * @param userId المستخدم المراد ربطه بالموظف
   * @returns أهلية الربط داخل معاملة الإنشاء
   */
  canLinkUser(userId: string): Promise<boolean>;
  /**
   * يحجز أول رقم وظيفي حر عند العدّاد أو بعده تحت قفل العدّاد، حتى لا يأخذ موظفان الرقم نفسه.
   *
   * @returns الرقم المسنَد داخل نفس معاملة الإنشاء
   */
  assignEmployeeNumber(): Promise<number>;
  /**
   * يحفظ الموظف برقمه الوظيفي ومفاتيح المطابقة وارتباط فرعه في نفس المعاملة، دون اعتماد أو منح جديد.
   *
   * @param record سجل الموظف
   * @param attachmentId معرف ارتباط الفرع
   * @returns اكتمال الحفظ داخل المعاملة
   */
  insert(record: EmployeeInsertRecord, attachmentId: string): Promise<void>;
  /**
   * يسجل snapshot مسموح الحقول، شاملاً الرقم الوظيفي المسنَد، وأي فشل يرد الإنشاء كله.
   *
   * @param record بيانات الموظف المسموح تسجيلها بعد إسناد الرقم
   * @returns اكتمال كتابة سجل التدقيق
   */
  audit(record: EmployeeRecord & { readonly employee_number: number }): Promise<void>;
}
/** حد المعاملة يسمح بإثبات rollback واختبار التنسيق دون قاعدة بيانات. */
export interface EmployeeTransactions {
  /**
   * يدخل الشركة المتحقق منها ويضم الموظف والفرع والتدقيق في commit واحد.
   *
   * @param actor الهوية المتحقق منها
   * @param actor.companyId الشركة المستهدفة
   * @param actor.userId المستخدم المسؤول عن التدقيق
   * @param work عملية الإنشاء على منفذ المعاملة
   * @returns ناتج العملية بعد نجاح commit
   */
  run<T>(
    actor: { companyId: string; userId: string },
    work: (scope: EmployeeCreationScope) => Promise<T>,
  ): Promise<T>;
}
