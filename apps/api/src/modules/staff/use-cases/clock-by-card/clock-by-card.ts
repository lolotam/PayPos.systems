import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import {
  attendanceDuplicate,
  planAttendance,
  type ClockResult,
} from '../../domain/clock-attendance.ts';
import type {
  CardClockScope,
  CardClockTransaction,
  CardClockTransactions,
  CardClockWrite,
} from '../../ports/clock-by-card.port.ts';

export { AttendanceError } from '../../domain/clock-attendance.ts';

/** الحركة بالكارت مدخل ثانٍ لنفس دومين spec 027، وتعيد فحص جلسة المشغل قبل الأثر. */
export class ClockByCard {
  constructor(
    private readonly transactions: CardClockTransactions,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}
  execute(
    scope: CardClockScope,
    input: { card_code: string },
    idem: { key: string; fingerprint: string },
  ): Promise<ClockResult> {
    return this.transactions.run(
      scope,
      input.card_code,
      () => this.clock.now(),
      (tx, at) =>
        tx.idempotent(idem.key, idem.fingerprint, async () => {
          await tx.confirmOperator(at);
          const duplicate = attendanceDuplicate(tx.context.lastAt, tx.context.lastResult, at);
          if (duplicate !== null) return duplicate;
          return this.apply(tx, at);
        }),
    );
  }
  private async apply(tx: CardClockTransaction, at: Date): Promise<ClockResult> {
    const context = tx.context;
    const plan = planAttendance(
      {
        open: context.open,
        timezone: context.timezone,
        shifts: context.shifts,
        location: context.location,
        geo: context.geo,
      },
      at,
      this.ids.newId(),
    );
    const write: CardClockWrite = {
      result: plan.result,
      open: context.open,
      closeAt: plan.closeAt,
      geo: plan.geo,
      at,
      schedule: plan.schedule,
    };
    await tx.persist(write);
    return plan.result;
  }
}
