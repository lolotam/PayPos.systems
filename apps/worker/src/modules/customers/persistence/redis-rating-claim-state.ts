import type { RatingClaimState } from '../ports/rating-claim-state.port.ts';
import {
  ownershipCommands,
  retryCommands,
  sweepCommands,
} from './redis-rating-claim-state.commands.ts';
import {
  buildContext,
  type RatingClaimStateOptions,
} from './redis-rating-claim-state.context.ts';

export type { RatingClaimStateOptions } from './redis-rating-claim-state.context.ts';

/**
 * منفذ حالة الجدولة على Redis: كل تعديل متسور برقم النسخة ورمز المالك، والوقت
 * كله من Redis TIME جوه السكربتات.
 *
 * @param options البادئة والعميل والحدود التقنية
 * @returns منفذ الحالة جاهز للربط في جذر الموديل
 */
export function redisRatingClaimState(options: RatingClaimStateOptions): RatingClaimState {
  const context = buildContext(options);
  return {
    ...ownershipCommands(context),
    ...sweepCommands(context),
    ...retryCommands(context),
  };
}
