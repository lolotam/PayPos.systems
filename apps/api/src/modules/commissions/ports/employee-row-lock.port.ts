import type { Tx } from '@pospay/db';

/** قفل صف الموظفة الذي توفره staff لعمليات تعديل العمولة المتزامنة: إصدارات الخطة وتجاوزات الخدمة. */
export interface EmployeeRowLockPort {
  /**
   * بيقفل الموظفة النشطة داخل النشاط بقفل FOR NO KEY UPDATE لتسلسل إصدارات الخطة وتجاوزات الخدمة، ويرجّع وجودها.
   *
   * @param tx معاملة commissions الحالية
   * @param companyId الشركة المؤكدة
   * @param businessId النشاط المالك
   * @param employeeId الموظفة المطلوبة
   * @returns true عند وجود الصف المقفول، وfalse عند غيابه أو حذفه
   */
  lock(tx: Tx, companyId: string, businessId: string, employeeId: string): Promise<boolean>;
}
