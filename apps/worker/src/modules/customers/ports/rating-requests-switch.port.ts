import type { Tx } from '@pospay/db';

/** مفتاح طلبات التقييم المستقل عن مفتاح تنبيهات الفريق. */
export interface RatingRequestsSwitchPort {
  /** يرجع هل النشاط فعّل الطلبات؛ القيمة غير المحفوظة تعني إيقافها قبل الجدولة والمطالبة. */
  enabled(tx: Tx, companyId: string, businessId: string): Promise<boolean>;
}
