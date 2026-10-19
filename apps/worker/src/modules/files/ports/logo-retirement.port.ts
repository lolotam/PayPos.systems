import type { Tx } from '@pospay/db';

/** قفل صف الملف وكتابة مؤشّر التسليم داخل معاملة المستهلك. */
export interface LogoRetirementStore {
  /**
   * يقفل صف شعار settings لهذا النشاط ويكتب purge_started_at إن كان READY ولم يبدأ الحذف.
   * مستند موظف أو شعار نشاط آخر في نفس الشركة لا يُعلَّم حتى لو لم يعد مربوطاً.
   *
   * @param tx معاملة الشركة
   * @param companyId الشركة
   * @param businessId النشاط صاحب الشعار
   * @param fileId الملف السابق
   * @param at وقت المؤشر المحقون
   * @returns ينتهي بعد المؤشر أو بعد التأكد أن الصف ليس شعاراً جاهزاً لهذا النشاط
   */
  markIfFree(
    tx: Tx,
    companyId: string,
    businessId: string,
    fileId: string,
    at: Date,
  ): Promise<void>;
}
