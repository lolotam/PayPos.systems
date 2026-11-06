import { z } from 'zod';
import { ownWorkMonth } from './own-service-lines.js';
import { sessionMoney } from './service-session.js';

export const ownTipsQuery = z.strictObject({ month: ownWorkMonth.optional() });
export const ownTips = z.discriminatedUnion('status', [
  z.strictObject({ month: ownWorkMonth, status: z.literal('HIDDEN') }),
  z.strictObject({
    month: ownWorkMonth,
    status: z.literal('VISIBLE'),
    total_cash: sessionMoney,
    total_card: sessionMoney,
  }),
]);
export type OwnTips = z.infer<typeof ownTips>;
