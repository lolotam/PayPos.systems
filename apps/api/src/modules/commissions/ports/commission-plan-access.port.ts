import type { Tx } from '@pospay/db';

/** إعادة فحص صلاحية إدارة العمولات التي توفرها identity عند جذر التركيب؛ تخدم كاتبَي إصدارات الخطة وتجاوزات الخدمة. */
export interface CommissionPlanAccessPort {
  /**
   * بيعيد قرار manage:commission-plans:business وميزة العمولات داخل معاملة الكتابة وبعد أقفالها.
   *
   * @param tx معاملة commissions الحالية
   * @param companyId الشركة المؤكدة
   * @param userId المستخدم البشري الفاعل
   * @param businessId النشاط المطلوب
   * @returns FORBIDDEN عند الرفض، أو FEATURE_DISABLED عند تعطيل الميزة، أو null عند السماح
   */
  recheck(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
}
