import type { Tx } from '@pospay/db';

/** قارئ تقويم النشاط يرتبط عند جذر التركيب، فلا تستورد commissions وحدة tenancy. */
export interface BusinessCalendarPort {
  /**
   * بيرجّع توقيت النشاط وتاريخ إنشائه من معاملة الكاتب لتحديد اليوم المحلي وأول شهر مسموح.
   *
   * @param tx معاملة commissions الحالية
   * @param companyId الشركة المؤكدة
   * @param businessId النشاط المالك للخطة
   * @returns التوقيت وتاريخ الإنشاء، أو null عند غياب النشاط
   */
  read(
    tx: Tx,
    companyId: string,
    businessId: string,
  ): Promise<{
    readonly timeZone: string;
    readonly createdAt: Date;
  } | null>;
}
