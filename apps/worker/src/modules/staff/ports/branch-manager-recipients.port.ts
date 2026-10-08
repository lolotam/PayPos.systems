import type { Tx } from '@pospay/db';

/**
 * قراءة أهلية الشركة من التينانسي ومديري فرع الوردية من الهوية، على معاملة الشركة المستدعية.
 * اللحظة المحقونة تُطبّق نافذة العضوية، وقائمة الأدوار تبقى في القاعدة المؤقتة.
 */
export interface BranchManagerRecipients {
  /**
   * أهلية الشركة الحالية من التينانسي؛ الشركة المحذوفة لا تسجل إشعاراً حتى لو بقي جدولها في Redis.
   *
   * @param tx معاملة المستأجر
   * @param companyId الشركة المجدولة
   * @returns هل الشركة موجودة وغير محذوفة
   */
  companyOpen(tx: Tx, companyId: string): Promise<boolean>;
  /**
   * مستخدمو العضويات النشطة التي تغطي الفرع بأحد الأدوار المعطاة.
   * المستدعي يتحقق أولاً من companyOpen بعد قفل الموظف على نفس المعاملة.
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
