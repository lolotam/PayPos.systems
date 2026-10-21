import type { StaffColumnCode } from '@pospay/contracts';
import type { Tx } from '@pospay/db';

/**
 * إعداد أعمدة تطبيق الموظفات اللي settings صاحبه، بيتقري جوه معاملة قراية «حضوري» (FR-A04)
 * عشان العمود المستخبي ما يطلعش من السيرفر (spec 060 D-A2، FR-A08، ADR-0010).
 */
export interface StaffColumnsPort {
  /**
   * بيرجّع الأعمدة المسموحة: المحفوظة أو افتراضي MY-Q3، وrating_average متشال لحد ما التقييم يرجع.
   *
   * @param tx         معاملة القراية
   * @param companyId  الشركة
   * @param businessId نشاط جلسة الموظفة
   * @returns الأكواد المسموحة
   */
  allowed(tx: Tx, companyId: string, businessId: string): Promise<ReadonlySet<StaffColumnCode>>;
  /**
   * بيرجّع كام شهر لورا الموظفة تشوف، والشهر الحالي منهم؛ مفيش إعداد = 1 (MY-Q9، D-A14).
   *
   * @param tx         معاملة القراية
   * @param companyId  الشركة
   * @param businessId نشاط جلسة الموظفة
   * @returns عدد الشهور من 1 لـ 24
   */
  monthsBack(tx: Tx, companyId: string, businessId: string): Promise<number>;
}
