import type { Tx } from '@pospay/db';

/**
 * قراءة files العكسية: هل الملف ما زال شعار النشاط.
 * العملية الوحيدة تقفل صف الإعدادات، فلا يقرأ files جدول settings بنفسه.
 */
export interface BusinessLogoReference {
  /**
   * يحجز صف الإعدادات ثم يبلّغ عن الإشارة الحالية حتى لا ينزلق ربط متزامن بين الفحص والمؤشر.
   *
   * @param tx معاملة الشركة
   * @param companyId الشركة
   * @param businessId النشاط
   * @param fileId الملف محل السؤال
   * @returns true إذا كان logo_file_id يساوي الملف
   */
  lock(tx: Tx, companyId: string, businessId: string, fileId: string): Promise<boolean>;
}
