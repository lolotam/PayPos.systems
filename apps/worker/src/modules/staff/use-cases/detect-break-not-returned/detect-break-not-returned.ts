import {
  breakNotReturnedDecision,
  breakNotReturnedParameters,
  breakReturnDeadline,
  dueBreakCutoff,
  interimBreakNotReturnedRule,
  type InterimBreakNotReturnedRule,
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

/** يكتشف عدم الرجوع من البريك لشركة واحدة: تنبيه واحد لكل موظفة وبداية وردية ما دامت الوردية جارية (BW-Q5). */
export class DetectBreakNotReturned {
  constructor(
    private readonly transactions: BreakNotReturnedTransactions,
    private readonly clock: Clock,
    private readonly nameFallback: NameFallback,
    private readonly diagnostics: NotClockedInDiagnostics,
  ) {}

  async execute(companyId: string): Promise<BreakNotReturnedRun> {
    const rule = interimBreakNotReturnedRule();
    if (!rule.enabled) return { notified: 0 };
    let progress: NotClockedInProgress = { notified: 0, failed: 0 };
    let after: NotClockedInCursor | null = null;
    for (;;) {
      const now = this.clock.now();
      const page = await this.transactions.candidates(
        companyId,
        dueBreakCutoff(now, rule.graceMs),
        now,
        after,
        BREAK_NOT_RETURNED_PAGE_SIZE,
      );
      for (const candidate of page) {
        const saved = await this.settle(companyId, candidate, rule).catch((error: unknown) => {
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

  private settle(
    companyId: string,
    candidate: DueBreak,
    rule: InterimBreakNotReturnedRule,
  ): Promise<boolean> {
    return this.transactions.run(
      companyId,
      candidate.employeeId,
      () => this.clock.now(),
      (tx, at) => this.assess(tx, candidate, rule, at),
    );
  }

  private async assess(
    tx: LockedBreakNotReturned,
    candidate: DueBreak,
    rule: InterimBreakNotReturnedRule,
    at: Date,
  ): Promise<boolean> {
    const shift = await tx.shift(candidate.id);
    if (shift === null || shift.startsAt.getTime() !== candidate.startsAt.getTime()) return false;
    const breakEndsAt = shift.breakEndsAt;
    if (breakEndsAt === null) return false;
    const leaves = await tx.approvedLeaves(
      shift.employeeId, breakEndsAt, shift.endsAt, shift.workingDate,
    );
    const deadline = breakReturnDeadline(
      { workingDate: shift.workingDate, endsAt: shift.endsAt, breakEndsAt },
      leaves,
      rule.graceMs,
    );
    const breakOutAt = await tx.breakOut(shift);
    const decision = breakNotReturnedDecision({
      now: at,
      shiftEndsAt: shift.endsAt,
      alertAt: deadline.alertAt,
      excused: deadline.excused,
      deleted: shift.deleted,
      contractEnd: shift.contractEnd,
      workingDate: shift.workingDate,
      breakOutAt,
      returned: breakOutAt !== null && (await tx.returned(shift, breakOutAt, at)),
    });
    if (decision !== 'ALERT' || breakOutAt === null) return false;
    return this.record(tx, shift, { breakEndsAt, breakOutAt, alertAt: deadline.alertAt }, at, rule);
  }

  private async record(
    tx: LockedBreakNotReturned,
    shift: LockedBreakShift,
    moments: { readonly breakEndsAt: Date; readonly breakOutAt: Date; readonly alertAt: Date },
    at: Date,
    rule: InterimBreakNotReturnedRule,
  ): Promise<boolean> {
    const managers = await tx.managers(shift.businessId, shift.branchId, rule.roles);
    const parameters = breakNotReturnedParameters(
      shift.nameAr,
      shift.nameEn,
      shift.branchNameAr,
      shift.branchNameEn,
      formatLocalShiftStart(moments.breakEndsAt, shift.timeZone),
      this.nameFallback,
    );
    if (parameters === null) throw new Error('ATTENDANCE_BREAK_NOT_RETURNED_PARAMETERS_INVALID');
    return tx.record({
      shift,
      ...moments,
      detectedAt: at,
      recipients: withoutAbsentEmployee(managers, shift.employeeUserId),
      parameters,
    });
  }
}
