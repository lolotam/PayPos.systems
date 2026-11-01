import {
  isClaimable,
  leaseRenewalDue,
  oldestEligibleAt,
  rereadObservation,
  type ClaimObservation,
  type ClaimSettlement,
  type RatingClaimsEndReason,
  type RatingClaimsTurnSummary,
  type VisitBudget,
} from '../../domain/rating-claim-scheduling.ts';
import type { Clock, IdGenerator } from '../../ports/clock.port.ts';
import type {
  ClaimStateCode,
  ClaimStateFence,
  ClaimStateResult,
  ClaimStateSnapshot,
} from '../../ports/rating-claim-state.port.ts';
import type { RatingClaimsPorts } from './rating-claims-ports.ts';

/** معاينة الطلب: المشاهدة اللي بتحدد التسوية، مع موعد الاستحقاق المخزن في الصف. */
export interface ClaimObservationResult {
  /** المشاهدة بعد المطالبة؛ وبتكون غايب (ABSENT) لما الطلب اتشال. */
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
