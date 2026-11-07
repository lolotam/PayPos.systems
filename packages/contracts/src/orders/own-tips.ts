import { z } from 'zod';
import { ownWorkMonth } from './own-work-month.js';
import { monthlyTipTotal } from './monthly-tip-total.js';

export const ownTipsQuery = z.strictObject({ month: ownWorkMonth.optional() });
export const ownTips = z.discriminatedUnion('status', [
  z.strictObject({ month: ownWorkMonth, status: z.literal('HIDDEN') }),
  z.strictObject({
    month: ownWorkMonth,
    status: z.literal('VISIBLE'),
    total_cash: monthlyTipTotal,
    total_card: monthlyTipTotal,
  }),
]);
export type OwnTips = z.infer<typeof ownTips>;
