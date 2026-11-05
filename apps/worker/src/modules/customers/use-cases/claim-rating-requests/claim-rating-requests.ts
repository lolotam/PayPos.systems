import {
  FORWARD_VISITS,
  RETRY_VISITS,
  assertVisitBudget,
  type RatingClaimsEndReason,
  type RatingClaimsTurnSummary,
  type VisitBudget,
} from '../../domain/rating-claim-scheduling.ts';
import type { Clock, IdGenerator } from '../../ports/clock.port.ts';
import type { ClaimStateCode } from '../../ports/rating-claim-state.port.ts';
import { runForwardLane } from './forward-lane.ts';
import { runRetryLane } from './retry-lane.ts';
import type { RatingClaimsPorts } from './rating-claims-ports.ts';
import { RatingClaimsTurnState } from './rating-claims-turn-state.ts';

export type {
  RatingClaimsEndReason,
  RatingClaimsTurnSummary,
} from '../../domain/rating-claim-scheduling.ts';
export type { RatingClaimsClaim, RatingClaimsPorts } from './rating-claims-ports.ts';
export { RatingClaimsTurnState, type ClaimObservationResult } from './rating-claims-turn-state.ts';

/** ملخص دور فاضي، للدور اللي وقف قبل ما يشتغل. */
function emptySummary(end: RatingClaimsEndReason): RatingClaimsTurnSummary {
  return {
    settlements: { TERMINAL: 0, ABSENT: 0, FUTURE_UNATTEMPTED: 0, RETRY: 0, DELEGATED: 0 },
    forwardVisits: 0,
    retryVisits: 0,
    end,
  };
}

/**
 * دور خدمة واحد لشركة واحدة: مسار الإعادة المحجوز أولاً، ثم مسار الجولة الأمامي.
 *
 * الدور بيملك حالة الشركة في Redis طول ما شغّال، وبيسيبها في آخره. أي رد حالة
 * مش مظبوط بيوقف الدور من غير إعادة محاولة أعمى.
 */
export class ClaimRatingRequests<Transaction = unknown> {
  constructor(
    private readonly ports: RatingClaimsPorts<Transaction>,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly budget: VisitBudget = { forward: FORWARD_VISITS, retry: RETRY_VISITS },
  ) {
    assertVisitBudget(this.budget);
  }

  /**
   * يشغّل دور خدمة واحدة للشركة، وبيرجّع ملخص الدور المنقّى.
   *
   * @param companyId الشركة المالكة للحالة
   * @returns أعداد التسويات وزيارات المسارين وسبب انتهاء الدور
   */
  async execute(companyId: string): Promise<RatingClaimsTurnSummary> {
    const ownerToken = this.ids.newId();
    const acquired = await this.ports.state.acquire(companyId, this.ids.newId(), ownerToken);
    if (acquired.code !== 'OK' || acquired.value === undefined) {
      return this.refused(companyId, acquired.code);
    }
    const turn = new RatingClaimsTurnState(
      companyId,
      this.ports,
      this.ids,
      this.clock,
      this.budget,
      {
        companyId,
        incarnation: acquired.value.incarnation,
        expectedVersion: acquired.value.version,
        ownerToken,
      },
      acquired.value,
    );
    let failure: { error: unknown } | undefined;
    try {
      await runRetryLane(turn);
      if (!turn.halted && !turn.limitReached) await runForwardLane(turn);
    } catch (error) {
      failure = { error };
    }
    try {
      await turn.release();
    } catch (releaseError) {
      // خطأ الإفلات ما يغطيش خطأ الدور؛ خطأ الدور هو الأهم للمشغّل.
      if (failure === undefined) throw releaseError;
    }
    if (failure !== undefined) throw failure.error;
    const summary = turn.summary();
    this.ports.diagnostics.turnSummary(companyId, summary);
    return summary;
  }

  /** الدور اللي ما اشترىش الحالة: ما فيش حاجة تتلمس، والسبب بيتسجل. */
  private refused(companyId: string, code: ClaimStateCode): RatingClaimsTurnSummary {
    switch (code) {
      case 'BUSY':
        return emptySummary('ACQUIRE_BUSY');
      case 'CORRUPT':
        this.ports.diagnostics.fenceLost(companyId, 'CORRUPT');
        return emptySummary('STATE_CORRUPT');
      case 'LIMIT':
        return emptySummary('LIMIT_REACHED');
      case 'OK':
      case 'STALE':
      case 'MISSING':
      case 'OVERFLOW':
        // رد ما يحملش لقطة: الحالة مش متاحة للدور، فالدور بيقف على فقد سور.
        return emptySummary('FENCE_LOST');
    }
  }
}
