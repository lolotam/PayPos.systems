import type { Tx } from '@pospay/db';

/**
 * قراءة مديري فرع الوردية من الهوية، على معاملة الشركة المستدعية.
 * اللحظة المحقونة تُطبّق نافذة العضوية، وقائمة الأدوار تبقى في القاعدة المؤقتة.
 */
export interface BranchManagerRecipients {
  /**
   * مستخدمو العضويات النشطة التي تغطي الفرع بأحد الأدوار المعطاة.
   *
   * @param tx معاملة الشركة بعد قفل State
   * @param companyId الشركة المجدولة، لتثبيت قراءة الفهرس داخل المستأجر
   * @param businessId نشاط الوردية
   * @param branchId فرع الوردية
   * @param at لحظة القرار من الساعة المحقونة
   * @param roles أدوار القاعدة؛ قائمة فارغة لا تُنفذ استعلاماً
   * @returns معرفات المستخدمين
   */
  forBranch(
    tx: Tx,
    companyId: string,
    businessId: string,
    branchId: string,
    at: Date,
    roles: readonly string[],
  ): Promise<readonly string[]>;
}
