import type { StaffColumnCode } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { ApiError } from '../../../shared/errors.ts';

export const OWN_WORK_READS = Symbol('OWN_WORK_READS');
export interface OwnWorkContext {
  companyId: string;
  businessId: string;
  userId: string;
  branchId?: string;
}
export interface OwnWorkBranch {
  id: string;
  name_ar: string | null;
  name_en: string;
}
export interface OwnWorkReads {
  /** يثبت الأهلية والسلطة الحالية دون تضييق فروع التاريخ. */
  context(
    tx: Tx,
    context: OwnWorkContext,
    now: Date,
  ): Promise<{
    employeeId: string;
    currentMonth: string;
    branches: readonly OwnWorkBranch[];
  } | null>;
  /** يفحص نافذة الشهور بدالة النطاق المحقونة. */
  periodAllowed(month: string, currentMonth: string, monthsBack: number): boolean;
  /** يقرأ نافذة الشهور الفعالة على نفس المعاملة. */
  monthsBack(tx: Tx, companyId: string, businessId: string): Promise<number>;
  /** يقرأ أكواد الإسقاط المسموحة من إعداد النشاط. */
  allowed(tx: Tx, companyId: string, businessId: string): Promise<ReadonlySet<StaffColumnCode>>;
  /** يجمع الفلوس عبر دالة النطاق؛ لا حساب مالي داخل مسار القراءة. */
  tipTotals(entries: readonly { method: 'CASH' | 'CARD'; amount: string }[]): {
    total_cash: string;
    total_card: string;
  };
}

export async function ownWorkAuthority(
  tx: Tx,
  context: OwnWorkContext,
  raw: unknown,
  now: Date,
  reads: OwnWorkReads,
) {
  const live = await reads.context(tx, context, now);
  if (!live) throw new ApiError('FORBIDDEN');
  if (
    raw !== null &&
    typeof raw === 'object' &&
    ['employee_id', 'branch_id', 'business_id', 'company_id'].some((key) => Object.hasOwn(raw, key))
  )
    throw new ApiError('FORBIDDEN');
  return live;
}

export async function ownWorkPeriod(
  tx: Tx,
  context: OwnWorkContext,
  month: string,
  currentMonth: string,
  reads: OwnWorkReads,
) {
  const monthsBack = await reads.monthsBack(tx, context.companyId, context.businessId);
  if (!reads.periodAllowed(month, currentMonth, monthsBack))
    throw new ApiError('MY_PERIOD_OUT_OF_RANGE');
  return reads.allowed(tx, context.companyId, context.businessId);
}
