import type { EmployeeIbanEntry } from '../domain/employee-iban.ts';

/** نطاق ثابت يحفظ الإذن والقفل حتى نهاية التغيير. */
export interface EmployeeIbanContext {
  companyId: string;
  userId: string;
  businessId: string;
  employeeId: string;
}
/** عمليات كتابة الحساب داخل معاملة واحدة. */
export interface EmployeeIbanTransaction {
  /** يقرأ آخر نسخة بعد قفل الموظف كي يقارن المحرر النسخة الصحيحة. */
  loadCurrent(): Promise<EmployeeIbanEntry | null>;
  /** يكشف وجود حساب حالي مطابق فقط، دون هوية الموظف الآخر.
   *
   * @param iban الحساب الموحد
   */
  ibanUsedByOtherEmployee(iban: string): Promise<boolean>;
  /** يضيف النسخة وتدقيقها معاً ويعيد وقت الحفظ.
   *
   * @param before النسخة السابقة
   * @param after النسخة الجديدة
   */
  save(before: EmployeeIbanEntry | null, after: EmployeeIbanEntry): Promise<EmployeeIbanEntry>;
}
/** حد المعاملة الذي يسبق العمل بتحقق حي من الإذن والميزة. */
export interface EmployeeIbanTransactions {
  /** يثبت أقفال الشركة والموظف ويضمن التراجع عن النسخة والتدقيق معاً.
   *
   * @param context نطاق العملية
   * @param work العمل داخل المعاملة
   */
  run<T>(
    context: EmployeeIbanContext,
    work: (tx: EmployeeIbanTransaction) => Promise<T>,
  ): Promise<T>;
}
/** مصدر المعرفات القابل للاستبدال في الاختبار. */
export interface EmployeeIbanIds {
  /** يولد معرّف نسخة مستقلاً دون عشوائية داخل حالة الاستخدام. */
  newId(): string;
}
