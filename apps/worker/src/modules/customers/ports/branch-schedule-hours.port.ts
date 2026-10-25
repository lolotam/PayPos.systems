import type { Tx } from '@pospay/db';
import type { BranchSchedule } from '../domain/sessions-of-day.ts';

/** قراءة مواعيد الفرع التي تملكها tenancy دون كشف جداولها لعملاء التقييم. */
export interface BranchScheduleHoursPort {
  /** يرجع مواعيد الفرع ومنطقته الفعّالة على معاملة المستدعي لحساب يوم الطلب وإغلاقه. */
  hours(tx: Tx, companyId: string, branchId: string): Promise<BranchSchedule | null>;
}
