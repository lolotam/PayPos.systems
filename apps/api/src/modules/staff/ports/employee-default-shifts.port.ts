import type { WeekdayDefaultShift } from '@pospay/domain';
import type { DefaultShiftLink } from '../domain/employee-default-shifts.ts';

/** لقطة الدوام المحفوظ كما تقرأها معاملة الحفظ؛ الـ http يتحقق منها بعقد الرد قبل ما ترجع للعميل. */
export interface EmployeeHoursSnapshot {
  employee_id: string;
  can_manage: boolean;
  branches: readonly ({ branch_id: string; can_manage: boolean } & Record<string, unknown>)[];
}
/** الشركة والمستخدم المتحقق منهما من الجلسة؛ المعاملة تضبط الـ tenant منهما ولا تأخذهما من الطلب. */
export interface EmployeeHoursActor { companyId: string; userId: string }
/**
 * عمليات حفظ الدوام داخل معاملة واحدة مقفولة: فحص الصلاحية، قفل الموظفة، القراءة، ثم الاستبدال مع التدقيق ولقطة الرد.
 * ترتيب الأقفال ثابت (الشركة ثم الموظفة) لتجنب الـ deadlock مع حفظ متزامن.
 */
export interface EmployeeHoursScope {
  /** يثبت صلاحية الإدارة على الفرع المطلوب والميزة تحت قفل الشركة قبل قفل الموظفة؛
   * الفحص على الفرع حتى يعمل منح المالك على مستوى فرع، والمنع على الفرع يغلب منح النشاط.
   *
   * @param businessId النشاط المتحقق منه
   * @param branchId الفرع اللي هيتحفظ دوامه
   */
  authorize(businessId: string, branchId: string): Promise<void>;
  /** يقفل الموظفة ويعيد فترات ارتباطها وتوقيت الفرع لفحص يوم التغيير.
   *
   * @param businessId النشاط
   * @param employeeId الموظفة
   * @param branchId الفرع
   */
  employee(businessId: string, employeeId: string, branchId: string): Promise<{
    links: DefaultShiftLink[]; timezone: string;
  }>;
  /** يقرأ الدوام بعد القفل لمنع مقارنة نسخة قديمة.
   *
   * @param employeeId الموظفة
   * @param branchId الفرع
   */
  current(employeeId: string, branchId: string): Promise<WeekdayDefaultShift[]>;
  /** يستبدل أسبوع فرع واحد ويسجل قبل وبعد في المعاملة نفسها.
   *
   * @param before الدوام السابق
   * @param after الدوام الجديد
   * @param at وقت التغيير من الساعة المحقونة
   */
  replace(before: readonly WeekdayDefaultShift[], after: readonly WeekdayDefaultShift[], at: Date): Promise<void>;
  /** يعيد الدوام المحفوظ ونطاق عرضه تحت أقفال معاملة الكتابة كي لا يحوّل سحب الإذن لاحقاً الحفظ الناجح إلى رفض. */
  result(): Promise<EmployeeHoursSnapshot>;
}
/** يفتح معاملة الحفظ الواحدة اللي تجمع الدوام وسطر التدقيق، فلا يُكتب أحدهما بدون الآخر. */
export interface EmployeeDefaultShiftsTransactions {
  /** يضمن التراجع عن الدوام والتدقيق معاً عند أي رفض.
   *
   * @param actor الشركة والمستخدم المتحقق منهما
   * @param work العمل المحمي بالأقفال
   */
  run<T>(actor: EmployeeHoursActor, work: (scope: EmployeeHoursScope) => Promise<T>): Promise<T>;
}
/** ساعة محقونة لحالة الاستخدام، حتى يُختبر «مرتبطة اليوم بتوقيت الفرع» عند منتصف الليل دون Date.now. */
export interface EmployeeHoursClock {
  /** يعطي وقتاً قابلاً للتثبيت لاختبار ارتباط الموظفة بتاريخ الفرع المحلي. */
  now(): Date;
}
