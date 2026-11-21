import type { StaffColumnCode } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { ApiError } from '../../../shared/errors.ts';

export const OWN_RATING_READS = Symbol('OWN_RATING_READS');
export interface OwnRatingContext {
  companyId: string;
  businessId: string;
  userId: string;
}
export interface OwnRatingReads {
  /** يثبت الأهلية والسلطة الحالية ويرجّع موظفة المستخدم وتوقيت النشاط. */
  context(
    tx: Tx,
    context: OwnRatingContext,
    now: Date,
  ): Promise<{ employeeId: string; timeZone: string } | null>;
  /** يقرأ أكواد إسقاط النشاط المسموحة؛ بوابة عمود rating_average من هنا (61-2a). */
  allowed(tx: Tx, companyId: string, businessId: string): Promise<ReadonlySet<StaffColumnCode>>;
}

export async function ownRatingAuthority(
  tx: Tx,
  context: OwnRatingContext,
  raw: unknown,
  now: Date,
  reads: OwnRatingReads,
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
