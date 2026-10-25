import type { Tx } from '@pospay/db';

/** مفتاح طلبات التقييم المستقل عن مفتاح تنبيهات الفريق. */
export interface RatingRequestsSwitchPort {
  /**
   * يرجع هل النشاط فعّل الطلبات؛ القيمة غير المحفوظة تعني إيقافها قبل الجدولة والمطالبة.
   *
   * @param tx معاملة المستأجر
   * @param companyId الشركة المالكة للنشاط
   * @param businessId النشاط المطلوب
   * @returns true عندما تكون طلبات التقييم مفعّلة
   */
  enabled(tx: Tx, companyId: string, businessId: string): Promise<boolean>;
}
