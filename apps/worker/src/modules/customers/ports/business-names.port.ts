import type { Tx } from '@pospay/db';

/** اسما النشاط: العربي (اختياري) والإنجليزي. */
export interface BusinessNames {
  /** الاسم العربي، أو null لو مش محفوظ. */
  readonly name_ar: string | null;
  /** الاسم الإنجليزي — دايماً موجود. */
  readonly name_en: string;
}

/**
 * أسماء النشاط، بتتقري من موديول tenancy: جدول النشاطات ملكه، ورسالة التقييم بتقراها
 * من بورت على معاملة المطالبة نفسها (CLAUDE.architecture.md §6.2).
 */
export interface BusinessNamesPort {
  /**
   * بيرجّع اسمي النشاط بالعربي والإنجليزي.
   *
   * @param tx معاملة القراية
   * @param companyId الشركة
   * @param businessId النشاط
   * @returns الاسمين، أو null لو النشاط مش موجود
   */
  names(tx: Tx, companyId: string, businessId: string): Promise<BusinessNames | null>;
}
