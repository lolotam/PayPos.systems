import type {
  BranchAttachment,
  EditableEmployee,
  EmployeeUpdatePlan,
} from '../domain/update-employee.ts';
import type { EmployeeCreationContext } from '../domain/create-employee.ts';

/** القفل والحفظ في معاملة واحدة يمنعان تغيير الإذن أثناء تعديل الموظف. */
export interface EmployeeUpdateScope {
  /**
   * يحمل سجل الشركة بعد أقفال PR 7؛ الغياب والمنع في المصدر لهما نفس النتيجة.
   *
   * @param businessId النشاط المتحقق منه
   * @param employeeId الموظف المطلوب
   * @returns السجل الحالي وارتباطاته أو الغياب الموحد
   */
  load(
    businessId: string,
    employeeId: string,
  ): Promise<{ record: EditableEmployee; active: readonly BranchAttachment[] } | null>;
  /**
   * يعيد الإذن عند كل الفروع المطلوبة؛ لا يسمح بالنقل إلى فرع ممنوع.
   *
   * @param businessId النشاط المحفوظ
   * @param branchIds الفروع المطلوبة
   * @returns السماح لكل الفروع
   */
  authorize(businessId: string, branchIds: readonly string[]): Promise<boolean>;
  /**
   * يعيد تبعية كل فرع دون قراءة نشاط شركة أخرى.
   *
   * @param record الموظف المحفوظ
   * @param branchIds الفروع المطلوب التحقق منها
   * @returns سياق كل فرع في نفس الشركة
   */
  contexts(
    record: EditableEmployee,
    branchIds: readonly string[],
  ): Promise<readonly EmployeeCreationContext[]>;
  /**
   * يثبت عضوية الربط النشطة داخل نفس الشركة بعد انتظار الأقفال.
   *
   * @param userId المستخدم المراد ربطه
   * @returns أهلية الربط دون كشف وجود هوية أجنبية
   */
  canLinkUser(userId: string): Promise<boolean>;
  /**
   * يحفظ النسخة والتاريخ والتدقيق ذرياً؛ المعرفات الجديدة مصدرها المنفذ المحقون.
   *
   * @param before البيانات قبل التغيير
   * @param plan الخطة التي ثبتتها قواعد المجال
   * @param effectiveDate التاريخ المدني الصريح
   * @param attachments معرفات الارتباطات الجديدة
   * @returns اكتمال الحفظ والتدقيق داخل المعاملة
   */
  save(
    before: EditableEmployee,
    plan: EmployeeUpdatePlan,
    effectiveDate: string,
    attachments: readonly { id: string; branchId: string }[],
  ): Promise<void>;
}
/** حد قاعدة البيانات يبقي التنسيق مستقلاً عن السائق ويتيح إثبات rollback. */
export interface EmployeeUpdateTransactions {
  /**
   * يدخل الشركة والفاعل المتحقق منهما ثم يحفظ كل آثار التعديل في commit واحد.
   *
   * @param actor الهوية المتحقق منها
   * @param actor.companyId الشركة المستهدفة
   * @param actor.userId الفاعل المسؤول عن التدقيق
   * @param work تنسيق التعديل على منافذ المعاملة
   * @returns الناتج بعد commit ناجح
   */
  run<T>(
    actor: { companyId: string; userId: string },
    work: (scope: EmployeeUpdateScope) => Promise<T>,
  ): Promise<T>;
}
