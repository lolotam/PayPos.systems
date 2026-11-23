import { z } from 'zod';

import { id } from '../scalars/id.js';
import { commissionRepairPeriod } from './plan-versions.js';

/**
 * حمولة حدث حفظ إصلاح شهر مقفول: معرفات ونتيجة التصحيح الموقوف بس، من غير خطة ولا مبالغ ولا بيانات شخصية.
 * `resolved` false لو فضل الموقوف (NO_SALARY, CM-52b).
 */
export const commissionPeriodRepairSaved = z.strictObject({
  business_id: id,
  employee_id: id,
  period: commissionRepairPeriod,
  version_id: id,
  blocked_correction_id: id,
  resolved: z.boolean(),
});

export type CommissionPeriodRepairSaved = z.infer<typeof commissionPeriodRepairSaved>;
