import { t } from '@pospay/i18n';
import {
  applyApprovedLeave,
  countingWindow,
  dueShiftCutoff,
  formatLocalShiftStart,
  interimNotClockedInRule,
  notClockedInDecision,
  recordNotClockedInOutcome,
  shiftNotClockedInParameters,
  withoutAbsentEmployee,
  type InterimNotClockedInRule,
  type NameFallback,
  type NotClockedInProgress,
} from '../../domain/not-clocked-in.ts';
import type { Clock } from '../../ports/clock.port.ts';
import type {
  DueShift,
  LockedNotClockedIn,
  LockedShift,
  NotClockedInCursor,
  NotClockedInTransactions,
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
  ) {}

  async execute(companyId: string): Promise<NotClockedInRun> {
    const rule = interimNotClockedInRule();
    if (!rule.enabled) return { notified: 0 };
    let progress: NotClockedInProgress = { notified: 0, failed: 0 };
    let after: NotClockedInCursor | null = null;
    for (;;) {
      const now = this.clock.now();
      const page = await this.transactions.candidates(
        companyId,
        dueShiftCutoff(now, rule.delayMs),
        now,
        after,
        NOT_CLOCKED_IN_PAGE_SIZE,
      );
      for (const candidate of page) {
        const saved = await this.settle(companyId, candidate, rule).catch(() => null);
        progress = recordNotClockedInOutcome(progress, saved);
      }
      const last = page.at(-1);
      if (page.length < NOT_CLOCKED_IN_PAGE_SIZE || last === undefined) break;
      after = { startsAt: last.startsAt, id: last.id };
    }
    if (progress.failed > 0) throw new Error('ATTENDANCE_NOT_CLOCKED_IN_RETRY');
    return { notified: progress.notified };
  }

  private settle(
    companyId: string,
    candidate: DueShift,
    rule: InterimNotClockedInRule,
  ): Promise<boolean> {
    return this.transactions.run(companyId, candidate.employeeId, () => this.clock.now(), (tx, at) =>
      this.assess(tx, candidate, rule, at),
    );
  }

  private async assess(
    tx: LockedNotClockedIn,
    candidate: DueShift,
    rule: InterimNotClockedInRule,
    at: Date,
  ): Promise<boolean> {
    const shift = await tx.shift(candidate.id);
    if (shift === null || shift.startsAt.getTime() !== candidate.startsAt.getTime()) return false;
    const leaves = await tx.approvedLeaves(shift.employeeId, shift.startsAt, shift.endsAt);
    const applied = applyApprovedLeave(shift, leaves, rule.delayMs);
    const window = countingWindow(shift.startsAt, applied.alertAt, rule.windowBeforeMs);
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
    });
    if (decision !== 'ALERT') return false;
    return this.record(tx, shift, applied.alertAt, at, rule.roles);
  }

  private async record(
    tx: LockedNotClockedIn,
    shift: LockedShift,
    alertAt: Date,
    at: Date,
    roles: InterimNotClockedInRule['roles'],
  ): Promise<boolean> {
    const managers = await tx.managers(shift.businessId, shift.branchId, roles);
    const parameters = shiftNotClockedInParameters(
      shift.nameAr,
      shift.nameEn,
      shift.branchNameAr,
      shift.branchNameEn,
      formatLocalShiftStart(shift.startsAt, shift.timeZone),
      catalogNameFallback(),
    );
    return tx.record({
      shift,
      alertAt,
      detectedAt: at,
      recipients: parameters === null ? [] : withoutAbsentEmployee(managers, shift.employeeUserId),
      parameters,
    });
  }
}

/** الأسماء العامة من الكتالوج، حتى يبقى النص الذي يراه المستخدم خارج الدومين. */
function catalogNameFallback(): NameFallback {
  return {
    employeeAr: t('ar', 'inApp.generic_employee'),
    employeeEn: t('en', 'inApp.generic_employee'),
    branchAr: t('ar', 'inApp.generic_branch'),
    branchEn: t('en', 'inApp.generic_branch'),
  };
}
