import type { Tx } from '@pospay/db';

/** يربط قارئ سلطة إدارة الكروت بالهوية دون تعريف منفذ في طبقة الاستعلامات. */
export const EMPLOYEE_CARD_ACCESS = Symbol('EMPLOYEE_CARD_ACCESS');

/** سلطة إدارة الموظف على فروعه المحفوظة؛ الكتابة تقفل الإذن قبل قراءة تلك الفروع. */
export interface EmployeeCardAccess {
  /**
   * يقيّم إدارة الموظفين على الفرع الأساسي والفروع المفتوحة المحفوظة.
   * سماح النشاط وحده لا يكفي، لأن منع فرع الموظف يبقى سارياً ويجب أن يطابق غياب الموظف.
   *
   * @param tx معاملة الشركة
   * @param companyId الشركة الموثقة
   * @param userId العامل طالب الإدارة
   * @param businessId النشاط المقصود
   * @param branchIds الفرع الأساسي والفروع المفتوحة المحفوظة للموظف
   * @returns إذن الإدارة وحالة ميزة الموارد البشرية
   */
  read(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
    branchIds: readonly string[],
  ): Promise<{ manage: boolean; featureEnabled: boolean }>;
  /**
   * يثبت أقفال الشركة وعضوية الطالب قبل قراءة فروع الموظف.
   * محرر الصلاحيات يأخذ الأقفال نفسها، ففحص الفروع بعده لا يسبق سحب الإذن أو نقل الفرع.
   *
   * @param tx معاملة الشركة
   * @param companyId الشركة الموثقة
   * @param userId العامل طالب الإدارة
   * @param businessId النشاط المقصود
   * @returns اكتمال الأقفال دون تقييم فرع
   */
  lock(tx: Tx, companyId: string, userId: string, businessId: string): Promise<void>;
}
