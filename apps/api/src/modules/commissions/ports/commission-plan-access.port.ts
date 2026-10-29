import type { Tx } from '@pospay/db';

/** إعادة فحص صلاحية إدارة الخطط التي توفرها identity عند جذر التركيب. */
export interface CommissionPlanAccessPort {
  /**
   * بيعيد قرار manage:commission-plans:business داخل معاملة الكتابة وبعد انتظار أقفالها.
   *
   * @param tx معاملة commissions الحالية
   * @param companyId الشركة المؤكدة
   * @param userId المستخدم البشري الفاعل
   * @param businessId النشاط المطلوب
   * @returns FORBIDDEN عند الرفض، أو null عند السماح
   */
  recheck(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<'FORBIDDEN' | null>;
}
