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
   * يقرأ إذن الإنشاء على النشاط والفرع بلا أقفال؛ معاينة النموذج تتكرر ولا يجوز أن تعطّل الكتابة.
   *
   * @param businessId النشاط المستهدف
   * @param branchId الفرع الأساسي المطلوب
   * @returns هل يملك الفاعل الإذن الحي؛ يرفض الفرع الخارجي أو الميزة المعطلة بخطأ مسمى
   */
  readCreationAccess(businessId: string, branchId: string): Promise<boolean>;
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
   * يعيد فحص manage:employee-number:company على نشاط الموظفة الجديدة وفرعها الأساسي فقط،
   * قبل قفل العدّاد، حتى يرفض المنع الرقم المكتوب دون أن يستهلك رقماً.
   *
   * @param businessId نشاط الموظفة الجديدة
   * @param primaryBranchId الفرع الأساسي الوحيد في طلب الإنشاء؛ تاريخ الارتباط لا يغيّر الفحص
   * @returns null عند السماح، أو FORBIDDEN أو FEATURE_DISABLED
   */
  recheckTypedNumber(
    businessId: string,
    primaryBranchId: string,
  ): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
  /**
   * يقفل عدّاد أرقام الشركة دون تحريكه حتى يتسلسل الرقم المكتوب مع الإسناد والتعديل اليدوي.
   *
   * @returns اكتمال القفل دون تغيير next_number
   */
  lockCounter(): Promise<void>;
  /**
   * هل الرقم محجوز لأي موظفة في الشركة بما فيها المحذوفة ناعماً.
   *
   * @param employeeNumber الرقم المكتوب
   * @returns true إذا وُجد الصف
   */
  typedNumberTaken(employeeNumber: number): Promise<boolean>;
  /**
   * يحفظ الموظف برقمه الوظيفي ومفاتيح المطابقة وارتباط فرعه في نفس المعاملة، دون اعتماد أو منح جديد.
   *
   * @param record سجل الموظف
   * @param attachmentId معرف ارتباط الفرع
   * @returns اكتمال الحفظ داخل المعاملة
   */
  insert(record: EmployeeInsertRecord, attachmentId: string): Promise<void>;
  /**
   * يحفظ رقماً مكتوباً؛ تعارض قيد الشركة يُرفض EMPLOYEE_NUMBER_TAKEN لأن الرقم لم يأتِ من العدّاد.
   *
   * @param record سجل الموظف برقمه المكتوب
   * @param attachmentId معرف ارتباط الفرع
   * @returns اكتمال الحفظ داخل المعاملة
   */
  insertTyped(record: EmployeeInsertRecord, attachmentId: string): Promise<void>;
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
