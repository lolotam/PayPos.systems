import {
  settleClaim,
  type ClaimObservation,
  type RetrySettlement,
} from '../../domain/rating-claim-scheduling.ts';
import type { RatingClaimsTurnState } from './rating-claims-turn-state.ts';

/**
 * مسار إعادة المحاولة: يحجز حتى R طلبات مستحقة، ويخدمهم واحد واحد بالتسلسل.
 *
 * التسوية بتتم بعد ما المعاملة تقفل، عشان النتيجة تكون مرجعية على القاعدة.
 */
export async function runRetryLane<Transaction>(
  turn: RatingClaimsTurnState<Transaction>,
): Promise<void> {
  const { ports, ids, budget } = turn;
  const workTokens: string[] = [];
  for (let index = 0; index < budget.retry; index += 1) workTokens.push(ids.newId());
  const reserved = await ports.state.reserveRetries(turn.fence, budget.retry, workTokens);
  turn.advance(reserved.version);
  if (reserved.code !== 'OK') {
    turn.halt(reserved.code);
    return;
  }
  for (const reservation of reserved.value?.reservations ?? []) {
    if (turn.limitReached) return;
    await turn.renewLease();
    // التجديد نفسه ممكن يكشف سقف الدور، فمفيش طلب بيتلمس بعد السقف.
    if (turn.halted || turn.limitReached) return;
    const observed = await turn.observe(reservation.requestId);
    const settlement = retrySettlement(observed.observation);
    const settled = await ports.state.settleRetry(
      turn.fence,
      reservation.requestId,
      reservation.workToken,
      settlement,
      observed.storedDueAt,
    );
    turn.accept(settled);
    if (settled.code !== 'OK') {
      turn.halt(settled.code);
      return;
    }
    turn.counts[settlement] += 1;
    turn.retryVisits += 1;
  }
}

/**
 * تسوية مسار الإعادة: الطلب اللي لسه في المستقبل بيتعاد، والباقي بيتبع القاعدة.
 *
 * الطلب اللي اتشال أو خلص نهائياً بيخرج من خريطة الإعادة، والطلب اللي فضل مجدول
 * أو اللي نتيجته مجهولة بيدخل تاني.
 */
function retrySettlement(observation: ClaimObservation): RetrySettlement {
  const settlement = settleClaim(observation);
  switch (settlement) {
    case 'TERMINAL':
    case 'ABSENT':
    case 'RETRY':
      return settlement;
    // الطلب المستقبلي ما ليوش تسوية هنا، والطلب اللي مسار تاني بيمرّره بيرجع
    // للقائمة؛ مسار الإعادة هو اللي بيخدمه.
    case 'FUTURE_UNATTEMPTED':
    case 'DELEGATED':
      return 'RETRY';
  }
}
