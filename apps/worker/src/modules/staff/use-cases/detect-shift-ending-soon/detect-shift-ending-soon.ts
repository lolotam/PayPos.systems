import { leadAlertPlan, type LeadAlertPlan } from '../../domain/alert-rule-plan.ts';
import {
  formatLocalShiftStart,
  recordNotClockedInOutcome,
  type NameFallback,
  type NotClockedInProgress,
} from '../../domain/not-clocked-in.ts';
import {
  endsSoonLeave,
  remindMoment,
  shiftEndsSoonParameters,
  shiftEndingSoonDecision,
} from '../../domain/shift-ending-soon.ts';
import type { Clock } from '../../ports/clock.port.ts';
import type {
  LockedShift,
  NotClockedInDiagnostics,
} from '../../ports/not-clocked-in.port.ts';
import type {
  DueShiftEnd,
  LockedShiftEnding,
  ShiftEndCursor,
  ShiftEndNoticeWrite,
  ShiftEndingSoonTransactions,
} from '../../ports/shift-ending-soon.port.ts';

export const SHIFT_ENDING_SOON_PAGE_SIZE = 100;

/** ما سجّلته دورة واحدة لشركة واحدة. */
export interface ShiftEndingSoonRun {
  notified: number;
}

/** يفحص نهاية الورديات لشركة واحدة ويذكّر الموظفة اللي شغالة قبل ما شيفتها تخلص. */
export class DetectShiftEndingSoon {
  constructor(
    private readonly transactions: ShiftEndingSoonTransactions,
    private readonly clock: Clock,
    private readonly nameFallback: NameFallback,
    private readonly diagnostics: NotClockedInDiagnostics,
  ) {}

  async execute(companyId: string): Promise<ShiftEndingSoonRun> {
    let progress: NotClockedInProgress = { notified: 0, failed: 0 };
    const cache = new Map<string, LeadAlertPlan>();
    let after: ShiftEndCursor | null = null;
    for (;;) {
      const now = this.clock.now();
      const page = await this.transactions.candidates(
        companyId,
        now,
        after,
        SHIFT_ENDING_SOON_PAGE_SIZE,
      );
      for (const candidate of page) {
        const saved = await this.settle(companyId, candidate, cache, now).catch((error: unknown) => {
          this.diagnostics.failed(companyId, error);
          return null;
        });
        progress = recordNotClockedInOutcome(progress, saved);
      }
      const last = page.at(-1);
      if (page.length < SHIFT_ENDING_SOON_PAGE_SIZE || last === undefined) break;
      after = { startsAt: last.startsAt, employeeId: last.employeeId };
    }
    if (progress.failed > 0) throw new Error('ATTENDANCE_SHIFT_ENDING_SOON_RETRY');
    return { notified: progress.notified };
  }

  private async settle(
    companyId: string,
    candidate: DueShiftEnd,
    cache: Map<string, LeadAlertPlan>,
    now: Date,
  ): Promise<boolean> {
    const plan = await this.plan(companyId, cache, candidate.businessId, candidate.branchId);
    const remindAt = remindMoment(candidate.startsAt, candidate.endsAt, plan.leadMs);
    if (now.getTime() < remindAt.getTime()) return false;
    // القاعدة مفتوحة: الموظفة اللي مش شغالة دلوقتي ما بتاخدش التذكير، ومفيش سطر بيتكتب (ADR-0053 قرار 4).
    if (plan.enabled && !candidate.hasOpenSession) return false;
    return this.transactions.run(
      companyId,
      candidate.employeeId,
      () => this.clock.now(),
      (tx, at) => this.assess(tx, companyId, candidate, at),
    );
  }

  // الكاش للترشيح بس؛ القرار بيقرا القاعدة تاني تحت القفل (ADR-0053 قرار 2).
  private async plan(
    companyId: string,
    cache: Map<string, LeadAlertPlan>,
    businessId: string,
    branchId: string,
  ): Promise<LeadAlertPlan> {
    const key = `${businessId}:${branchId}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const plan = leadAlertPlan(
      await this.transactions.rule(companyId, { businessId, branchId }, 'SHIFT_ENDS_SOON'),
    );
    cache.set(key, plan);
    return plan;
  }

  private async assess(
    tx: LockedShiftEnding,
    companyId: string,
    candidate: DueShiftEnd,
    at: Date,
  ): Promise<boolean> {
    const shift = await tx.shift(candidate.id);
    if (shift === null) return false;
    // الأسبوع اتحفظ تاني: الوردية الجديدة ليها لحظة نهاية تانية ومفتاح تاني (SE-Q3).
    if (shift.startsAt.getTime() !== candidate.startsAt.getTime()) return false;
    if (shift.endsAt.getTime() !== candidate.endsAt.getTime()) return false;
    const plan = leadAlertPlan(
      await tx.rules.rule(
        companyId,
        { businessId: shift.businessId, branchId: shift.branchId },
        'SHIFT_ENDS_SOON',
      ),
    );
    const leaves = await tx.approvedLeaves(
      shift.employeeId,
      shift.startsAt,
      shift.endsAt,
      shift.workingDate,
    );
    const remindAt = remindMoment(shift.startsAt, shift.endsAt, plan.leadMs);
    const decision = shiftEndingSoonDecision({
      now: at,
      shiftEndsAt: shift.endsAt,
      remindAt,
      workingDate: shift.workingDate,
      deleted: shift.deleted,
      contractEnd: shift.contractEnd,
      excused: endsSoonLeave(shift, leaves),
      ruleEnabled: plan.enabled,
      hasOpenSession: await tx.hasOpenSession(shift.employeeId),
    });
    if (decision === 'SUPPRESS') {
      await tx.suppress({ shift, remindAt, detectedAt: at });
      return false;
    }
    if (decision !== 'REMIND') return false;
    return tx.record(await this.notice(tx, shift, remindAt, at, plan));
  }

  private async notice(
    tx: LockedShiftEnding,
    shift: LockedShift,
    remindAt: Date,
    at: Date,
    plan: LeadAlertPlan,
  ): Promise<ShiftEndNoticeWrite> {
    const userId =
      shift.employeeUserId !== null &&
      plan.employeePush &&
      (await tx.userHasAccess(shift.employeeUserId, at))
        ? shift.employeeUserId
        : null;
    const parameters = shiftEndsSoonParameters(
      shift.branchNameAr,
      shift.branchNameEn,
      formatLocalShiftStart(shift.endsAt, shift.timeZone),
      this.nameFallback,
    );
    if (parameters === null) throw new Error('ATTENDANCE_SHIFT_ENDING_SOON_PARAMETERS_INVALID');
    return { shift, remindAt, detectedAt: at, userId, parameters };
  }
}
