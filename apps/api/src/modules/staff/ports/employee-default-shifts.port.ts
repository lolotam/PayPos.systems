import type { WeekdayDefaultShift } from '@pospay/domain';
import type { DefaultShiftLink } from '../domain/employee-default-shifts.ts';

export interface EmployeeHoursActor { companyId: string; userId: string }
export interface EmployeeHoursScope {
  /** يثبت صلاحية الإدارة والميزة تحت قفل الشركة قبل قفل الموظفة.
   *
   * @param businessId النشاط المتحقق منه
   */
  authorize(businessId: string): Promise<void>;
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
}
export interface EmployeeDefaultShiftsTransactions {
  /** يضمن التراجع عن الدوام والتدقيق معاً عند أي رفض.
   *
   * @param actor الشركة والمستخدم المتحقق منهما
   * @param work العمل المحمي بالأقفال
   */
  run<T>(actor: EmployeeHoursActor, work: (scope: EmployeeHoursScope) => Promise<T>): Promise<T>;
}
export interface EmployeeHoursClock {
  /** يعطي وقتاً قابلاً للتثبيت لاختبار ارتباط الموظفة بتاريخ الفرع المحلي. */
  now(): Date;
}
