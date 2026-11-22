import type {
  CommissionPeriodEmployee as PostingPeriodEmployee,
  CommissionTipMethod as PostingTipMethod,
  LockedCommissionPeriod as PostingLockedPeriod,
} from '@pospay/commissions-posting';
import { expectTypeOf, it } from 'vitest';

import type {
  CommissionPeriodEmployee,
  LockedCommissionPeriod,
} from '../domain/commission-line-types.ts';
import type { CommissionTipMethod } from '../domain/commission-tip-salary-inputs.ts';

/**
 * الـ domain في الـ worker ممنوع يستورد الحزمة، فالأنواع الثلاثة دي معرّفة مرتين. المقارنة هنا وقت
 * الترجمة بس: لو اختلف تعريف في أي ناحية، `tsc` على الـ worker يفشل بدل ما ينحرفوا بصمت.
 */
it('keeps the three types the worker domain shares with the posting package identical', () => {
  expectTypeOf<CommissionPeriodEmployee>().toEqualTypeOf<PostingPeriodEmployee>();
  expectTypeOf<LockedCommissionPeriod>().toEqualTypeOf<PostingLockedPeriod>();
  expectTypeOf<CommissionTipMethod>().toEqualTypeOf<PostingTipMethod>();
});
