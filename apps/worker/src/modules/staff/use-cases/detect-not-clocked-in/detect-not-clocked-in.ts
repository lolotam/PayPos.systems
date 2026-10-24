import {
  MIN_ALERT_DELAY_MS,
  employeePushRecipient,
  periodicAlertPlan,
  type PeriodicAlertPlan,
} from '../../domain/alert-rule-plan.ts';
import {
  NOT_CLOCKED_IN_WINDOW_BEFORE_MS,
  applyApprovedLeave,
  countingWindow,
  dueShiftCutoff,
  formatLocalShiftStart,
  notClockedInDecision,
  recordNotClockedInOutcome,
  shiftNotClockedInParameters,
  withoutAbsentEmployee,
  type NameFallback,
  type NotClockedInProgress,
} from '../../domain/not-clocked-in.ts';
import { shiftNotClockedInSelfParameters } from '../../domain/not-clocked-in-self.ts';
import type { Clock } from '../../ports/clock.port.ts';
import type {
  DueShift,
  EmployeePush,
  LockedNotClockedIn,
  LockedShift,
  NotClockedInCursor,
  NotClockedInTransactions,
  NotClockedInDiagnostics,
} from '../../ports/not-clocked-in.port.ts';

export const NOT_CLOCKED_IN_PAGE_SIZE = 100;

/** ما سجّلته دورة واحدة لشركة واحدة. */
export interface NotClockedInRun {
  notified: number;
}

/** يكتشف عدم الحضور لشركة واحدة: تنبيه واحد لكل موظف وبداية وردية ما دامت الوردية جارية. */
export class DetectNotClockedIns {
  constructor(
    private readonly transactions: NotClockedInTransactions,
    private readonly clock: Clock,
    private readonly nameFallback: NameFallback,
    private readonly diagnostics: NotClockedInDiagnostics,
  ) {}

  async execute(companyId: string): Promise<NotClockedInRun> {
    let progress: NotClockedInProgress = { notified: 0, failed: 0 };
    let after: NotClockedInCursor | null = null;
    for (;;) {
      const now = this.clock.now();
      const page = await this.transactions.candidates(
        companyId,
        dueShiftCutoff(now, MIN_ALERT_DELAY_MS),
        now,
        after,
        NOT_CLOCKED_IN_PAGE_SIZE,
      );
      for (const candidate of page) {
        const saved = await this.settle(companyId, candidate).catch((error: unknown) => {
          this.diagnostics.failed(companyId, error);
          return null;
        });
        progress = recordNotClockedInOutcome(progress, saved);
      }
      const last = page.at(-1);
      if (page.length < NOT_CLOCKED_IN_PAGE_SIZE || last === undefined) break;
      after = { startsAt: last.startsAt, id: last.id };
    }
    if (progress.failed > 0) throw new Error('ATTENDANCE_NOT_CLOCKED_IN_RETRY');
    return { notified: progress.notified };
  }

  private settle(companyId: string, candidate: DueShift): Promise<boolean> {
    return this.transactions.run(
      companyId,
      candidate.employeeId,
      () => this.clock.now(),
      (tx, at) => this.assess(tx, companyId, candidate, at),
    );
  }

  private async assess(
    tx: LockedNotClockedIn,
    companyId: string,
    candidate: DueShift,
    at: Date,
  ): Promise<boolean> {
    const shift = await tx.shift(candidate.id);
    if (shift === null || shift.startsAt.getTime() !== candidate.startsAt.getTime()) return false;
    const plan = periodicAlertPlan(
      await tx.rules.rule(
        companyId,
        { businessId: shift.businessId, branchId: shift.branchId },
        'SHIFT_NOT_CLOCKED_IN',
      ),
    );
    const leaves = await tx.approvedLeaves(
      shift.employeeId, shift.startsAt, shift.endsAt, shift.workingDate,
    );
    const applied = applyApprovedLeave(shift, leaves, plan.delayMs);
    const window = countingWindow(shift.startsAt, applied.alertAt, NOT_CLOCKED_IN_WINDOW_BEFORE_MS);
    const clockIns = await tx.clockIns(shift.employeeId, window.start, window.end);
    const decision = notClockedInDecision({
      now: at,
      shiftEndsAt: shift.endsAt,
      alertAt: applied.alertAt,
      windowStart: window.start,
      excused: applied.excused,
      deleted: shift.deleted,
      contractEnd: shift.contractEnd,
      workingDate: shift.workingDate,
      clockIns,
      presenceSession: await tx.presenceSession(shift.employeeId, applied.alertAt),
    });
    if (decision !== 'ALERT') return false;
    if (!plan.enabled) {
      // القاعدة مقفولة: سطر دفتر واحد بلا إشعار، والوردية ما تتنبهش تاني (spec 060 D-B15).
      await tx.suppress({ shift, alertAt: applied.alertAt, detectedAt: at });
      return false;
    }
    return this.record(tx, shift, applied.alertAt, at, plan);
  }

  private async record(
    tx: LockedNotClockedIn,
    shift: LockedShift,
    alertAt: Date,
    at: Date,
    plan: PeriodicAlertPlan,
  ): Promise<boolean> {
    const managers: readonly string[] =
      plan.roles.length === 0
        ? []
        : await tx.managers(shift.businessId, shift.branchId, plan.roles);
    const parameters = shiftNotClockedInParameters(
      shift.nameAr,
      shift.nameEn,
      shift.branchNameAr,
      shift.branchNameEn,
      formatLocalShiftStart(shift.startsAt, shift.timeZone),
      this.nameFallback,
    );
    if (parameters === null) throw new Error('ATTENDANCE_NOT_CLOCKED_IN_PARAMETERS_INVALID');
    return tx.record({
      shift,
      alertAt,
      detectedAt: at,
      recipients: withoutAbsentEmployee(managers, shift.employeeUserId),
      parameters,
      employeePushUserId: employeePushRecipient(plan, shift.employeeUserId),
      employeePush: await this.employeePush(tx, shift, at, plan),
    });
  }

  // إشعار الموظفة بنفسها: هدف ثابت من القاعدة، وصلاحيتها الشخصية لازم تكون سارية لحظة التنبيه (ADR-0052 §5).
  private async employeePush(
    tx: LockedNotClockedIn,
    shift: LockedShift,
    at: Date,
    plan: PeriodicAlertPlan,
  ): Promise<EmployeePush | null> {
    const target = employeePushRecipient(plan, shift.employeeUserId);
    if (target === null || !(await tx.userHasAccess(target, shift, at))) return null;
    const parameters = shiftNotClockedInSelfParameters(
      shift.branchNameAr,
      shift.branchNameEn,
      formatLocalShiftStart(shift.startsAt, shift.timeZone),
      this.nameFallback,
    );
    if (parameters === null) throw new Error('ATTENDANCE_NOT_CLOCKED_IN_PARAMETERS_INVALID');
    return { userId: target, parameters };
  }
}
