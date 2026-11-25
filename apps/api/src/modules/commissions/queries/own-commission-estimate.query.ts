import { ownCommissionEstimate, ownCommissionEstimateQuery } from '@pospay/contracts';
import type { Tx } from '@pospay/db';

import { ApiError } from '../../../shared/errors.ts';
import {
  ownCommissionAuthority,
  ownCommissionPeriod,
  type OwnCommissionContext,
  type OwnCommissionEstimateReads,
} from './own-commission-estimate-context.ts';

// شاشة «عمولتي»: السلطة الحية ثم نافذة الشهور ثم بوابة العمود؛ المخفي ما بيلمسش جداول العمولات.
export async function readOwnCommissionEstimate(
  tx: Tx,
  c: OwnCommissionContext,
  raw: unknown,
  now: Date,
  reads: OwnCommissionEstimateReads,
) {
  const live = await ownCommissionAuthority(tx, c, raw, now, reads);
  const parsed = ownCommissionEstimateQuery.safeParse(raw);
  if (!parsed.success) throw new ApiError('VALIDATION_FAILED');
  const month = parsed.data.month ?? live.currentMonth;
  const allowed = await ownCommissionPeriod(tx, c, month, live.currentMonth, reads);
  if (!allowed.has('estimated_commission')) return ownCommissionEstimate.parse({ status: 'HIDDEN' });
  return ownCommissionEstimate.parse(
    await reads.estimate(tx, {
      companyId: c.companyId,
      businessId: c.businessId,
      employeeId: live.employeeId,
      period: month,
    }),
  );
}
