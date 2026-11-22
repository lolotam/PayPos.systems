/**
 * قارئ حاملي صلاحية النشاط، مربوط بالهوية عند جذر التوصيل عشان وحدة العمولات ما تعرفش جداول العضويات (D-16).
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة
 * @param businessId النشاط
 * @param permission كود الصلاحية
 * @param at لحظة قراءة العضويات والمنح
 * @returns معرفات المستخدمين المؤهلين
 */
export type CommissionPermissionHoldersReader<Transaction> = (
  tx: Transaction,
  companyId: string,
  businessId: string,
  permission: string,
  at: Date,
) => Promise<readonly string[]>;
