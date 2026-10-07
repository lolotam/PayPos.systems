import type { Tx } from '@pospay/db';

/** يربط قارئ سلطة إدارة الكروت بالهوية دون تعريف منفذ في طبقة الاستعلامات. */
export const EMPLOYEE_CARD_ACCESS = Symbol('EMPLOYEE_CARD_ACCESS');

/** سلطة إدارة الموظفين وحالة الميزة؛ الكتابة تثبتهما تحت القفل. */
export interface EmployeeCardAccess {
  /** يقرأ السلطة التي تحتاجها شاشة الكارت دون منح الكتابة.
   *
   * @param tx معاملة الشركة
   * @param companyId الشركة الموثقة
   * @param userId العامل طالب الإدارة
   * @param businessId النشاط المقصود
   * @returns إذن الإدارة وحالة ميزة الموارد البشرية
   */
  read(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<{ manage: boolean; featureEnabled: boolean }>;
  /** يثبت السلطة قبل الإصدار أو الإلغاء كي لا تتجاوز الكتابة سحب الإذن.
   *
   * @param tx معاملة الشركة
   * @param companyId الشركة الموثقة
   * @param userId العامل طالب الإدارة
   * @param businessId النشاط المقصود
   * @returns إذن الإدارة وحالة الميزة تحت القفل
   */
  lock(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<{ manage: boolean; featureEnabled: boolean }>;
}
