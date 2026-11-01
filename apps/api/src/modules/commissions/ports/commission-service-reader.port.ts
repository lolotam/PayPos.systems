import type { Tx } from '@pospay/db';

/**
 * قارئ وجود الخدمة الذي تملكه commissions، لأن الكتابة ما تستوردش catalog ولا تقرأ قاعدته الحية.
 * الوجود بس هو المطلوب: قاعدة الخدمة الحية مش مرجع تاريخ، واللقطة المحفوظة على السطر هي المرجع.
 */
export interface CommissionServiceReaderPort {
  /**
   * بيتأكد إن الخدمة موجودة في النشاط داخل معاملة الكاتب نفسها.
   *
   * @param tx معاملة commissions الحالية
   * @param companyId الشركة المؤكدة
   * @param businessId النشاط المالك للخدمة
   * @param serviceId الخدمة المطلوبة
   * @returns true عند وجود الخدمة في النشاط
   */
  exists(
    tx: Tx,
    companyId: string,
    businessId: string,
    serviceId: string,
  ): Promise<boolean>;
}
