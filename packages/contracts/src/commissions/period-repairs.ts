import { z } from 'zod';

import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import {
  commissionPlanComponent,
  commissionPlanTiers,
  commissionPlanVersion,
  commissionRepairPeriod,
} from './plan-versions.js';

/**
 * طلب إصلاح شهر مقفول (FR-047): الشهر المحجوز والخطة اللي هتسعّر أيامه اللي ما كانش ليها خطة.
 * الخطة هنا من غير تاريخ سريان ولا whole_period، لأن الإصلاح بيسري في شهره بس وتاريخه أول الشهر (D-12).
 */
export const commissionRepairPlan = z
  .strictObject({
    base: commissionPlanComponent,
    tiers: commissionPlanTiers,
    package_sale: commissionPlanComponent,
  })
  .meta({ id: 'CommissionRepairPlan' });

export const createCommissionPeriodRepairInput = z
  .strictObject({ period: commissionRepairPeriod, plan: commissionRepairPlan })
  .meta({ id: 'CreateCommissionPeriodRepairInput' });

/** حالة التصحيح الموقوف بعد الإصلاح: محلول لو التسعير نجح ونشر، أو اتبدّل كوده لـ NO_SALARY على نفس الصف (CM-52b). */
export const commissionPeriodRepairBlock = responseObject({
  id,
  code: z.enum(['NO_PLAN', 'NO_SALARY']),
  resolved: z.boolean(),
})
  .strict()
  .meta({ id: 'CommissionPeriodRepairBlock' });

export const commissionPeriodRepair = responseObject({
  version: commissionPlanVersion,
  blocked_correction: commissionPeriodRepairBlock,
})
  .strict()
  .meta({ id: 'CommissionPeriodRepair' });

/** رفض الإصلاح لما مفيش تصحيح موقوف بكود NO_PLAN لنفس الموظفة والشهر: 422 من غير details. */
export const commissionRepairNotAllowedError = z
  .strictObject({
    code: z.literal('COMMISSION_REPAIR_NOT_ALLOWED'),
    message_ar: z.string().min(1),
    message_en: z.string().min(1),
  })
  .meta({ id: 'CommissionRepairNotAllowedError' });

export const commissionPeriodRepairSchemas = [
  commissionRepairPlan,
  createCommissionPeriodRepairInput,
  commissionPeriodRepairBlock,
  commissionPeriodRepair,
  commissionRepairNotAllowedError,
];

export type CreateCommissionPeriodRepairInput = z.infer<typeof createCommissionPeriodRepairInput>;
export type CommissionPeriodRepair = z.infer<typeof commissionPeriodRepair>;
