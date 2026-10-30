import type { Tx } from '@pospay/db';

/** قفل صف الموظفة الذي توفره staff لعمليات الخطة المتزامنة. */
export interface EmployeeRowLockPort {
  /**
   * بيقفل الموظفة النشطة داخل النشاط بقفل FOR NO KEY UPDATE ويرجّع وجودها لتخصيص رقم الإصدار تسلسلياً.
   *
   * @param tx معاملة commissions الحالية
   * @param companyId الشركة المؤكدة
   * @param businessId النشاط المالك
   * @param employeeId الموظفة المطلوبة
   * @returns true عند وجود الصف المقفول، وfalse عند غيابه أو حذفه
   */
  lock(tx: Tx, companyId: string, businessId: string, employeeId: string): Promise<boolean>;
}
