import type { BranchSchedule } from '../domain/sessions-of-day.ts';

/** قراءة مواعيد الفرع التي تملكها tenancy دون كشف جداولها لعملاء التقييم. */
export interface BranchScheduleHoursPort<Transaction = unknown> {
  /**
   * يرجع مواعيد الفرع ومنطقته الفعّالة على معاملة المستدعي لحساب يوم الطلب وإغلاقه.
   *
   * @param tx معاملة المستأجر
   * @param companyId الشركة المالكة للفرع
   * @param branchId الفرع المطلوب
   * @returns المواعيد والمنطقة، أو null إذا لم يوجد الفرع
   */
  hours(tx: Transaction, companyId: string, branchId: string): Promise<BranchSchedule | null>;
}
