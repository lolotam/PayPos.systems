import {
  MIN_ALERT_DELAY_MS,
  periodicAlertPlan,
  type PeriodicAlertPlan,
} from '../../domain/alert-rule-plan.ts';
import {
  BREAK_OUT_LEAD_MS,
  breakNotReturnedDecision,
  breakNotReturnedParameters,
  breakOutWindowStart,
  breakReturnDeadline,
  breakReturnedOtherBranchParameters,
  dueBreakCutoff,
  graceElapsed,
  type BreakReturn,
} from '../../domain/break-not-returned.ts';
import {
  formatLocalShiftStart,
  recordNotClockedInOutcome,
  withoutAbsentEmployee,
  type NameFallback,
  type NotClockedInProgress,
} from '../../domain/not-clocked-in.ts';
import type { Clock } from '../../ports/clock.port.ts';
import type {
  BreakNotReturnedTransactions,
  DueBreak,
  LockedBreakNotReturned,
  LockedBreakShift,
} from '../../ports/break-not-returned.port.ts';
import type {
  NotClockedInCursor,
  NotClockedInDiagnostics,
} from '../../ports/not-clocked-in.port.ts';

export const BREAK_NOT_RETURNED_PAGE_SIZE = 100;

/** ما سجّلته دورة واحدة لشركة واحدة. */
export interface BreakNotReturnedRun {
  notified: number;
}

/** لحظات البريك اللي بتتعمل في الدفتر: آخر البريك، الخروج، ولحظة الاستحقاق. */
interface BreakMoments {
  readonly breakEndsAt: Date;
  readonly breakOutAt: Date;
  readonly alertAt: Date;
}

/** يفحص رجوع البريك لشركة واحدة؛ الغياب ينبه، والرجوع لفرع آخر يخطر مديري فرع الخروج مرة واحدة (BW-Q10). */
export class DetectBreakNotReturned {
  constructor(
    private readonly transactions: BreakNotReturnedTransactions,
    private readonly clock: Clock,
    private readonly nameFallback: NameFallback,
    private readonly diagnostics: NotClockedInDiagnostics,
  ) {}

  async execute(companyId: string): Promise<BreakNotReturnedRun> {
    let progress: NotClockedInProgress = { notified: 0, failed: 0 };
    let after: NotClockedInCursor | null = null;
    for (;;) {
      const now = this.clock.now();
      const page = await this.transactions.candidates(
        companyId,
        dueBreakCutoff(now, MIN_ALERT_DELAY_MS),
        now,
        BREAK_OUT_LEAD_MS,
        after,
        BREAK_NOT_RETURNED_PAGE_SIZE,
      );
      for (const candidate of page) {
        const saved = await this.settle(companyId, candidate).catch((error: unknown) => {
          this.diagnostics.failed(companyId, error);
          return null;
        });
        progress = recordNotClockedInOutcome(progress, saved);
      }
      const last = page.at(-1);
      if (page.length < BREAK_NOT_RETURNED_PAGE_SIZE || last === undefined) break;
      after = { startsAt: last.startsAt, id: last.id };
    }
    if (progress.failed > 0) throw new Error('ATTENDANCE_BREAK_NOT_RETURNED_RETRY');
    return { notified: progress.notified };
  }

  private settle(companyId: string, candidate: DueBreak): Promise<boolean> {
    return this.transactions.run(
      companyId,
      candidate.employeeId,
      () => this.clock.now(),
      (tx, at) => this.assess(tx, companyId, candidate, at),
    );
  }

  private async assess(
    tx: LockedBreakNotReturned,
    companyId: string,
    candidate: DueBreak,
    at: Date,
  ): Promise<boolean> {
    const shift = await tx.shift(candidate.id);
    if (shift === null || shift.startsAt.getTime() !== candidate.startsAt.getTime()) return false;
    const breakEndsAt = shift.breakEndsAt;
    if (breakEndsAt === null) return false;
    const breakStartsAt = shift.breakStartsAt;
    if (breakStartsAt === null) return false;
    const breakOutAt = await tx.breakOut(
      shift, breakOutWindowStart(breakStartsAt, BREAK_OUT_LEAD_MS),
    );
    if (breakOutAt === null) return false;
    const returned = await tx.returned(shift, breakOutAt, at);
    const otherBranch = returned !== null && returned.branchId !== shift.branchId;
    // النوعان مستقلان في التوقيت: إشعار الرجوع لفرع آخر بياخد قاعدة نفسه، مش قاعدة عدم الرجوع.
    const plan = periodicAlertPlan(
      await tx.rules.rule(
        companyId,
        { businessId: shift.businessId, branchId: shift.branchId },
        otherBranch ? 'SHIFT_BREAK_RETURNED_OTHER_BRANCH' : 'SHIFT_BREAK_NOT_RETURNED',
      ),
    );
    const leaves = await tx.approvedLeaves(
      shift.employeeId, breakEndsAt, shift.endsAt, shift.workingDate,
    );
    const deadline = breakReturnDeadline(
      { workingDate: shift.workingDate, endsAt: shift.endsAt, breakEndsAt },
      leaves,
      plan.delayMs,
    );
    const decision = breakNotReturnedDecision({
      now: at,
      shiftEndsAt: shift.endsAt,
      alertAt: deadline.alertAt,
      excused: deadline.excused,
      deleted: shift.deleted,
      contractEnd: shift.contractEnd,
      workingDate: shift.workingDate,
      breakOutAt,
      shiftBranchId: shift.branchId,
      returnedBranchId: returned?.branchId ?? null,
    });
    if (decision !== 'ALERT' && decision !== 'RETURNED_OTHER_BRANCH') return false;
    if (decision === 'RETURNED_OTHER_BRANCH' && !graceElapsed(breakEndsAt, at, plan.delayMs))
      return false;
    const moments: BreakMoments = { breakEndsAt, breakOutAt, alertAt: deadline.alertAt };
    if (!plan.enabled) {
      await tx.suppress({ shift, ...moments, detectedAt: at });
      return false;
    }
    return this.record(tx, shift, moments, at, plan, decision === 'ALERT' ? null : returned);
  }

  private async record(
    tx: LockedBreakNotReturned,
    shift: LockedBreakShift,
    moments: BreakMoments,
    at: Date,
    plan: PeriodicAlertPlan,
    returned: BreakReturn | null,
  ): Promise<boolean> {
    const managers: readonly string[] =
      plan.roles.length === 0
        ? []
        : await tx.managers(shift.businessId, shift.branchId, plan.roles);
    const parameters = returned === null ? breakNotReturnedParameters(
      shift.nameAr,
      shift.nameEn,
      shift.branchNameAr,
      shift.branchNameEn,
      formatLocalShiftStart(moments.breakEndsAt, shift.timeZone),
      this.nameFallback,
    ) : breakReturnedOtherBranchParameters(shift.nameAr, shift.nameEn, returned, this.nameFallback);
    if (parameters === null) throw new Error('ATTENDANCE_BREAK_NOT_RETURNED_PARAMETERS_INVALID');
    return tx.record({
      kind: returned === null ? 'break_not_returned' : 'break_returned_other_branch',
      returned,
      shift,
      ...moments,
      detectedAt: at,
      recipients: withoutAbsentEmployee(managers, shift.employeeUserId),
      parameters,
    });
  }
}
