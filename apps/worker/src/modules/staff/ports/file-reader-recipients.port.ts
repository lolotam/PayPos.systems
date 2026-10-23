import type { Tx } from '@pospay/db';

/**
 * من يملك صلاحية قراءة ملفات النشاط: قراءة واحدة من الهوية لجرس انتهاء المستند.
 */
export interface FileReaderRecipients {
  /**
   * معرّفات المستخدمين الذين يملكون صلاحية قراءة الملفات على النشاط في لحظة معيّنة.
   *
   * @param tx معاملة الشركة
   * @param companyId الشركة
   * @param businessId النشاط
   * @param at لحظة القرار من الساعة المحقونة
   * @returns معرّفات المستخدمين مرتبة
   */
  holders(
    tx: Tx,
    companyId: string,
    businessId: string,
    at: Date,
  ): Promise<readonly string[]>;
}
