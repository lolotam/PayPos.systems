import type { Tx } from '@pospay/db';

/** إعادة فحص صلاحية صرف كشف العمولة التي توفرها identity عند جذر التركيب (54-1). */
export interface CommissionStatementPayAccessPort {
  /**
   * بيعيد قرار pay:commissions:business وميزة العمولات داخل معاملة الصرف وبعد أقفالها.
   *
   * @param tx معاملة الصرف الحالية
   * @param companyId الشركة المؤكدة
   * @param userId المستخدم البشري الفاعل
   * @param businessId نشاط الكشف المطلوب
   * @returns FORBIDDEN عند الرفض، أو FEATURE_DISABLED عند تعطيل الميزة، أو null عند السماح
   */
  recheck(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
}
