import type { OwnCommissionEstimate, StaffColumnCode } from '@pospay/contracts';
import type { Tx } from '@pospay/db';

import { ApiError } from '../../../shared/errors.ts';

export const OWN_COMMISSION_ESTIMATE_READS = Symbol('OWN_COMMISSION_ESTIMATE_READS');

/** هوية الجلسة اللي بتتحقق منها القراءة: الشركة والنشاط والمستخدم، والفرع لو الجهاز مقيّد بفرع. */
export interface OwnCommissionContext {
  companyId: string;
  businessId: string;
  userId: string;
  branchId?: string;
}

/** طلب الإسقاط: الموظفة من الجلسة وحدها، والشهر بعد فحص النافذة. */
export interface OwnCommissionEstimateRequest {
  companyId: string;
  businessId: string;
  employeeId: string;
  period: string;
}

export interface OwnCommissionEstimateReads {
  /** يثبت الأهلية والسلطة الحالية، ويرجع توقيت النشاط الذي حُسب به الشهر الحالي. */
  context(
    tx: Tx,
    context: OwnCommissionContext,
    now: Date,
  ): Promise<{ employeeId: string; currentMonth: string; timeZone: string } | null>;
  /** يفحص نافذة الشهور بدالة النطاق المحقونة. */
  periodAllowed(month: string, currentMonth: string, monthsBack: number): boolean;
  /** يقرأ نافذة الشهور الفعالة على نفس المعاملة. */
  monthsBack(tx: Tx, companyId: string, businessId: string): Promise<number>;
  /** يقرأ أكواد الإسقاط المسموحة من إعداد النشاط. */
  allowed(tx: Tx, companyId: string, businessId: string): Promise<ReadonlySet<StaffColumnCode>>;
  /** يقرأ تقدير الشهر لموظفة واحدة؛ ما بيتناداش إلا بعد فتح بوابة العمود. */
  estimate(tx: Tx, request: OwnCommissionEstimateRequest): Promise<OwnCommissionEstimate>;
}

/**
 * يثبت السلطة الحية قبل أي قراءة، ويرفض أي مفتاح موضوع في الطلب.
 *
 * @param tx معاملة القراءة
 * @param context هوية الجلسة
 * @param raw الاستعلام الخام كما وصل
 * @param now عينة الساعة المشتركة
 * @param reads القراءات المحقونة
 * @returns الموظفة والشهر الحالي وتوقيت النشاط
 */
export async function ownCommissionAuthority(
  tx: Tx,
  context: OwnCommissionContext,
  raw: unknown,
  now: Date,
  reads: OwnCommissionEstimateReads,
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

/**
 * يفحص نافذة الشهور ثم يرجع أكواد الإسقاط المسموحة.
 *
 * @param tx معاملة القراءة
 * @param context هوية الجلسة
 * @param month الشهر المطلوب
 * @param currentMonth الشهر الحالي في توقيت النشاط
 * @param reads القراءات المحقونة
 * @returns أكواد الإسقاط المسموحة
 */
export async function ownCommissionPeriod(
  tx: Tx,
  context: OwnCommissionContext,
  month: string,
  currentMonth: string,
  reads: OwnCommissionEstimateReads,
) {
  const monthsBack = await reads.monthsBack(tx, context.companyId, context.businessId);
  if (!reads.periodAllowed(month, currentMonth, monthsBack))
    throw new ApiError('MY_PERIOD_OUT_OF_RANGE');
  return reads.allowed(tx, context.companyId, context.businessId);
}
