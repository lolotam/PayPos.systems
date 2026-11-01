import {
  FORWARD_VISITS,
  RETRY_VISITS,
  assertVisitBudget,
  isClaimable,
  leaseRenewalDue,
  rereadObservation,
  type ClaimObservation,
  type ClaimSettlement,
  type RatingClaimsEndReason,
  type RatingClaimsTurnSummary,
  type VisitBudget,
} from '../../domain/rating-claim-scheduling.ts';
import type { Clock, IdGenerator } from '../../ports/clock.port.ts';
import type { RatingClaimDiagnostics } from '../../ports/rating-claim-diagnostics.port.ts';
import type { RatingClaimRepository } from '../../ports/rating-claim.repository.ts';
import type { RatingClaimTransactions } from '../../ports/rating-claim-transactions.port.ts';
import type {
  ClaimStateCode,
  ClaimStateFence,
  ClaimStateResult,
  ClaimStateSnapshot,
  ClaimStateRetry,
  RatingClaimState,
} from '../../ports/rating-claim-state.port.ts';
import type {
  ClaimOutcome,
  ClaimRatingRequestInput,
} from '../claim-rating-request/claim-rating-request.ts';
import { runForwardLane } from './forward-lane.ts';
import { runRetryLane } from './retry-lane.ts';

export type {
  RatingClaimsEndReason,
  RatingClaimsTurnSummary,
} from '../../domain/rating-claim-scheduling.ts';

/** منفذ المطالبة على الطلب الواحد: هو نفسه مسار المطالبة، من غير أي تغيير. */
export interface RatingClaimsClaim<Transaction = unknown> {
  /**
   * يطالب بطلب التقييم جوه المعاملة المفتوحة.
   *
   * @param tx معاملة المستأجر المفتوحة
   * @param input الشركة والطلب المقروء
   * @returns نتيجة المطالبة
   */
  execute(tx: Transaction, input: ClaimRatingRequestInput): Promise<ClaimOutcome>;
}

/** منافذ دور المطالبة: حالة الجدولة، والمعاملات، وإعادة القراءة، والمطالبة، والتشخيص. */
export interface RatingClaimsPorts<Transaction = unknown> {
  /** حالة الجدولة في Redis، وهي الحدّ الشبكي للدور كله. */
  readonly state: RatingClaimState;
  /** معاملات المستأجر لقراءة حدود الجولة وقراءة الطلب الواحد. */
  readonly transactions: RatingClaimTransactions<Transaction>;
  /** إعادة قراءة الطلب في نفس معاملة المطالبة. */
  readonly requests: Pick<RatingClaimRepository<Transaction>, 'findRequest'>;
  /** المطالبة نفسها. */
  readonly claim: RatingClaimsClaim<Transaction>;
  /** تشخيص الدور: الفشل، والفيضان، وفقد السور، والملخص. */
  readonly diagnostics: RatingClaimDiagnostics;
}

/** معاينة الطلب: المشاهدة اللي بتحدد التسوية، مع موعد الاستحقاق المخزن في الصف. */
export interface ClaimObservationResult {
  /** المشاهدة بعد المطالبة، أو بدونها لو الطلب اتشال. */
  readonly observation: ClaimObservation;
  /** موعد الاستحقاق المخزن في الصف، أو null. */
  readonly storedDueAt: Date | null;
}

/**
 * حالة الدور أثناء التنفيذ: السور واللقطة والأعداد، وبتتحدث مع كل رد.
 *
 * الحالة دي ملك الدور وحده، والنقل بين المسارات بيتم بنفس الكائن عشان رقم
 * النسخة ما يتغيّرش في نص الدور.
 */
export class RatingClaimsTurnState<Transaction = unknown> {
  readonly counts: Record<ClaimSettlement, number> = {
    TERMINAL: 0,
    ABSENT: 0,
    FUTURE_UNATTEMPTED: 0,
    RETRY: 0,
    DELEGATED: 0,
  };
  forwardVisits = 0;
  retryVisits = 0;
  limitReached = false;
  halted = false;
  end: RatingClaimsEndReason = 'COMPLETED';
  lastRenewalAt: Date;

  constructor(
    readonly companyId: string,
    readonly ports: RatingClaimsPorts<Transaction>,
    readonly ids: IdGenerator,
    readonly clock: Clock,
    readonly budget: VisitBudget,
    public fence: ClaimStateFence,
    public snapshot: ClaimStateSnapshot,
  ) {
    this.lastRenewalAt = clock.now();
  }

  /** يحدّث سور الدور بلقطة النتيجة، لأن كل تعديل على الحالة بيزوّد رقم النسخة. */
  accept(result: ClaimStateResult<ClaimStateSnapshot>): void {
    this.fence = { ...this.fence, expectedVersion: result.version };
    if (result.value !== undefined) this.snapshot = result.value;
  }

  /** يحدّث رقم نسخة السور بعد أمر ما رجعش لقطة، زي حجز إعادات المحاولة. */
  advance(version: number): void {
    this.fence = { ...this.fence, expectedVersion: version };
  }

  /** يجدّد حجز المالك لو مستحق، وبيوقف الدور لو سقف الملكية اتقضى. */
  async renewLease(): Promise<void> {
    if (this.limitReached) return;
    if (!leaseRenewalDue(this.clock.now(), this.lastRenewalAt)) return;
    const renewed = await this.ports.state.renew(this.fence);
    this.accept(renewed);
    if (renewed.code === 'OK') {
      this.lastRenewalAt = this.clock.now();
      return;
    }
    if (renewed.code === 'LIMIT') {
      // سقف الملكية: الدور يكمّل اللي في إيده، بس ما يبدأش صف جديد.
      this.limitReached = true;
      this.end = 'LIMIT_REACHED';
      return;
    }
    this.halt(renewed.code);
  }

  /** يوقف الدور بسبب رد حالة مش مظبوط، ويسجّل فقد السور لما الرد يكون فقد سور. */
  halt(code: ClaimStateCode): void {
    this.halted = true;
    if (code === 'CORRUPT') {
      this.end = 'STATE_CORRUPT';
      this.ports.diagnostics.fenceLost(this.companyId, 'CORRUPT');
      return;
    }
    if (code === 'LIMIT') {
      this.limitReached = true;
      this.end = 'LIMIT_REACHED';
      return;
    }
    this.end = 'FENCE_LOST';
    if (code === 'STALE' || code === 'BUSY') {
      this.ports.diagnostics.fenceLost(this.companyId, code);
    }
  }

  /**
   * يقرأ الطلب في معاملته، ويطالبله لو مستحق، ويعيد مشاهدة النتيجة.
   *
   * الخطأ أو الـ commit المجهول بيبقى إعادة محاولة مش نهاية، عشان الباقي يكمّل.
   */
  async observe(requestId: string): Promise<ClaimObservationResult> {
    try {
      return await this.ports.transactions.withRequest(
        this.companyId,
        requestId,
        async (tx, request): Promise<ClaimObservationResult> => {
          if (request === null) return { observation: { kind: 'ABSENT' }, storedDueAt: null };
          if (!isClaimable(request, this.clock.now())) {
            if (request.status !== 'SCHEDULED') {
              return {
                observation: { kind: 'STATUS', status: request.status },
                storedDueAt: request.dueAt,
              };
            }
            return { observation: { kind: 'FUTURE_UNATTEMPTED' }, storedDueAt: request.dueAt };
          }
          await this.ports.claim.execute(tx, { companyId: this.companyId, request });
          const reread = await this.ports.requests.findRequest(tx, this.companyId, requestId);
          if (reread === null) return { observation: { kind: 'ABSENT' }, storedDueAt: null };
          return { observation: rereadObservation(reread.status), storedDueAt: reread.dueAt };
        },
      );
    } catch (error) {
      this.ports.diagnostics.failed(this.companyId, error);
      return { observation: { kind: 'UNKNOWN' }, storedDueAt: null };
    }
  }

  /** يسجّل فيضان خريطة الإعادة: العدّاد وأقدم استحقاق وآخر جولة كاملة. */
  reportOverflow(result: ClaimStateResult<ClaimStateSnapshot>): void {
    const snapshot = result.value;
    if (snapshot === undefined) return;
    this.ports.diagnostics.overflow(this.companyId, {
      overflowCount: snapshot.overflowCount,
      oldestRetryEligibleAt: oldestEligibleAt(snapshot.retries),
      now: this.clock.now().getTime(),
      lastCompletedSweepId: snapshot.lastCompletedSweepId,
      reconcileRequired: snapshot.reconcileRequired,
    });
  }

  /** يسيب ملكية الحالة في آخر الدور، حتى لو الدور وقف في نص الشغل. */
  async release(): Promise<void> {
    await this.ports.state.release(this.fence);
  }

  /** ملخص الدور المنقّى: أعداد التسويات وزيارات المسارين وسبب الانتهاء. */
  summary(): RatingClaimsTurnSummary {
    return {
      settlements: { ...this.counts },
      forwardVisits: this.forwardVisits,
      retryVisits: this.retryVisits,
      end: this.end,
    };
  }
}

/** أقدم لحظة استحقاق في خريطة الإعادة، أو null لما الخريطة فاضية. */
function oldestEligibleAt(retries: Readonly<Record<string, ClaimStateRetry>>): number | null {
  let oldest: number | null = null;
  for (const retry of Object.values(retries)) {
    if (oldest === null || retry.eligibleAt < oldest) oldest = retry.eligibleAt;
  }
  return oldest;
}

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
