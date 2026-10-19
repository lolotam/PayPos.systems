import type { Tx } from '@pospay/db';

/** قراءة عكسية يملكها files: هل الملف ما زال شعار النشاط تحت قفل الإعدادات. */
export interface LogoReference {
  /**
   * يقفل صف إعدادات النشاط ويبلّغ إن كان الملف ما زال الشعار حتى لا يقرأ files جدول settings.
   *
   * @param tx معاملة الشركة
   * @param companyId الشركة
   * @param businessId النشاط
   * @param fileId الملف السابق في الحدث
   * @returns true إذا كان logo_file_id يساوي الملف
   */
  holds(tx: Tx, companyId: string, businessId: string, fileId: string): Promise<boolean>;
}
