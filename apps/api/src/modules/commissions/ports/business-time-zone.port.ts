import type { Tx } from '@pospay/db';

/** قارئ توقيت النشاط يرتبط عند جذر التركيب، فلا تستورد commissions وحدة tenancy. */
export interface BusinessTimeZonePort {
  /**
   * بيرجّع توقيت النشاط من معاملة الكاتب نفسها لتحديد تاريخ اليوم المحلي.
   *
   * @param tx معاملة commissions الحالية
   * @param companyId الشركة المؤكدة
   * @param businessId النشاط المالك للخطة
   * @returns اسم IANA أو null عند غياب النشاط
   */
  read(tx: Tx, companyId: string, businessId: string): Promise<string | null>;
}
